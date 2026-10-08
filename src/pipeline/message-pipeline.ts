import { performance } from 'node:perf_hooks';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/database.js';
import type { ConversationRepository } from '../repositories/conversation-repository.js';
import type {
  DecisionRecord,
  DecisionRepository,
  StoredDecision,
} from '../repositories/decision-repository.js';
import type { MessageRepository } from '../repositories/message-repository.js';
import type { RetrievedArticle, Retriever } from '../retrieval/retriever.js';
import type { Classification, IntentClassifier } from './classifier.js';
import { trimHistory } from './history.js';
import type { EscalationPolicy, Verdict } from './policy.js';
import type { Responder, ResponderResult } from './responder.js';
import { greetingMessage, holdingMessage } from './templates.js';
import { addUsage, type Language, type Usage, ZERO_USAGE } from './types.js';
import type { OutputValidator, ValidationResult } from './validator.js';

export interface IncomingMessage {
  channel: string;
  external_message_id: string;
  customer_id: string;
  customer_name?: string | undefined;
  text: string;
  received_at: string;
}

export interface PipelineResponse {
  conversation_id: string;
  action: StoredDecision['action'];
  reply_text: string | null;
  reasons: StoredDecision['reasons'];
  intent: StoredDecision['intent'];
  confidence: number | null;
  citations: StoredDecision['citations'];
}

export interface PipelineOutcome {
  response: PipelineResponse;
  replayed: boolean;
}

export interface PipelineDeps {
  db: Db;
  conversations: ConversationRepository;
  messages: MessageRepository;
  decisions: DecisionRepository;
  classifier: IntentClassifier;
  retriever: Retriever;
  responder: Responder;
  validator: OutputValidator;
  policy: EscalationPolicy;
  model: string;
  pricing: { inputPerMTok: number; outputPerMTok: number };
  historyTokenBudget: number;
  logCustomerText: boolean;
}

/** Upper bound on rows fetched before token-based trimming; keeps the query cheap. */
const HISTORY_ROW_LIMIT = 50;

interface Draft {
  verdict: Verdict;
  language: Language;
  classification: Classification | null;
  retrieved: RetrievedArticle[];
  responder: ResponderResult | null;
  validation: ValidationResult | null;
  usage: Usage;
  stages: Record<string, number>;
}

export class MessagePipeline {
  /** Coalesces concurrent webhook retries of the same message within this process. */
  private readonly inFlight = new Map<string, Promise<PipelineOutcome>>();

  constructor(private readonly deps: PipelineDeps) {}

  async handle(message: IncomingMessage, logger: FastifyBaseLogger): Promise<PipelineOutcome> {
    const stored = this.findStored(message);
    if (stored) {
      return { response: stored, replayed: true };
    }
    const key = `${message.channel}\u0000${message.external_message_id}`;
    const running = this.inFlight.get(key);
    if (running) {
      const outcome = await running;
      return { ...outcome, replayed: true };
    }
    const promise = this.process(message, logger).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private findStored(message: IncomingMessage): PipelineResponse | undefined {
    const messageId = this.deps.messages.findIdByExternalId(
      message.channel,
      message.external_message_id,
    );
    const decision =
      messageId === undefined ? undefined : this.deps.decisions.findByMessageId(messageId);
    return decision ? toResponse(decision) : undefined;
  }

  private async process(
    message: IncomingMessage,
    logger: FastifyBaseLogger,
  ): Promise<PipelineOutcome> {
    const startedAt = performance.now();
    const conversation = this.deps.conversations.upsert(
      message.channel,
      message.customer_id,
      message.customer_name ?? null,
    );
    const history = trimHistory(
      this.deps.messages.recentTurns(conversation.id, HISTORY_ROW_LIMIT),
      this.deps.historyTokenBudget,
    );

    const draft = await this.decide(message.text, history, conversation.status);
    const decision = this.buildDecision(conversation.id, draft, performance.now() - startedAt);

    const saved = this.persist(message, decision);
    if (!saved) {
      // Another instance stored this message first (UNIQUE(channel, external_message_id)).
      const stored = this.findStored(message);
      if (stored) {
        return { response: stored, replayed: true };
      }
      throw new Error('Message was stored concurrently but its decision is missing');
    }

    logger.info(
      {
        conversationId: conversation.id,
        channel: message.channel,
        externalMessageId: message.external_message_id,
        action: decision.action,
        reasons: decision.reasons,
        intent: decision.intent,
        latencyMs: decision.latencyMs,
        ...(this.deps.logCustomerText ? { text: message.text } : {}),
      },
      'message decision',
    );
    return { response: toResponse(decision), replayed: false };
  }

  private async decide(
    text: string,
    history: Parameters<IntentClassifier['classify']>[1],
    status: 'bot' | 'human',
  ): Promise<Draft> {
    const draft: Draft = {
      verdict: { action: 'none', reasons: [] },
      language: 'id',
      classification: null,
      retrieved: [],
      responder: null,
      validation: null,
      usage: ZERO_USAGE,
      stages: {},
    };

    const silent = this.deps.policy.checkConversation(status);
    if (silent) {
      draft.verdict = silent;
      return draft;
    }

    const classification = await timed(draft.stages, 'classify_ms', () =>
      this.deps.classifier.classify(text, history),
    );
    draft.classification = classification;
    draft.language = classification.language;
    draft.usage = addUsage(draft.usage, classification.usage);
    const afterClassify = this.deps.policy.checkClassification(classification);
    if (afterClassify) {
      draft.verdict = afterClassify;
      return draft;
    }

    draft.retrieved = await timed(draft.stages, 'retrieve_ms', () =>
      Promise.resolve(this.deps.retriever.retrieve(text)),
    );
    const afterRetrieve = this.deps.policy.checkRetrieval(draft.retrieved);
    if (afterRetrieve) {
      draft.verdict = afterRetrieve;
      return draft;
    }

    const answer = await timed(draft.stages, 'answer_ms', () =>
      this.deps.responder.respond(text, history, classification.language, draft.retrieved),
    );
    draft.responder = answer;
    if (answer.ok) {
      draft.usage = addUsage(draft.usage, answer.usage);
      draft.validation = await timed(draft.stages, 'validate_ms', () =>
        Promise.resolve(
          this.deps.validator.validate(
            answer.rawAnswer,
            draft.retrieved.map((hit) => hit.article),
          ),
        ),
      );
    }
    draft.verdict = this.deps.policy.checkAnswer(answer, draft.validation);
    return draft;
  }

  private buildDecision(conversationId: string, draft: Draft, latencyMs: number): DecisionRecord {
    const { verdict, classification, validation } = draft;
    const answer = validation?.answer ?? null;
    const replyText = this.replyText(draft);
    const citations =
      verdict.action === 'reply' && answer
        ? answer.cited_article_ids.flatMap((id) => {
            const hit = draft.retrieved.find((item) => item.article.id === id);
            return hit ? [{ article_id: id, title: hit.article.title }] : [];
          })
        : [];
    return {
      messageId: 0,
      conversationId,
      action: verdict.action,
      replyText,
      reasons: verdict.reasons,
      intent: classification?.intent ?? null,
      language: classification ? draft.language : null,
      classifierSource: classification?.source ?? 'skipped',
      classifierConfidence: classification?.confidence ?? null,
      answerConfidence: answer?.confidence ?? null,
      confidence: answer?.confidence ?? classification?.confidence ?? null,
      citations,
      retrieved: draft.retrieved.map((hit) => ({ article_id: hit.article.id, score: hit.score })),
      classifyPrompt: classification?.promptVersion ?? null,
      answerPrompt: draft.responder?.promptVersion ?? null,
      model: classification ? this.deps.model : null,
      inputTokens: draft.usage.inputTokens,
      outputTokens: draft.usage.outputTokens,
      estimatedCostUsd: this.estimateCost(draft.usage),
      latencyMs: Math.round(latencyMs),
      stageLatencies: draft.stages,
    };
  }

  private replyText(draft: Draft): string | null {
    switch (draft.verdict.action) {
      case 'none':
        return null;
      case 'escalate':
        return holdingMessage(draft.language);
      case 'reply':
        if (draft.verdict.reasons.includes('greeting_template')) {
          return greetingMessage(draft.language);
        }
        return draft.validation?.answer?.reply ?? null;
    }
  }

  private estimateCost(usage: Usage): number {
    const { inputPerMTok, outputPerMTok } = this.deps.pricing;
    return (usage.inputTokens * inputPerMTok + usage.outputTokens * outputPerMTok) / 1_000_000;
  }

  /**
   * Stores the customer message, the decision, any outgoing text and the hand-off in one
   * transaction, so a crash can never leave a message without its decision (which would make
   * a webhook retry look like a new message). Returns false if the message already exists.
   */
  private persist(message: IncomingMessage, decision: DecisionRecord): boolean {
    const { db, messages, decisions, conversations } = this.deps;
    return db.transaction(() => {
      if (messages.findIdByExternalId(message.channel, message.external_message_id) !== undefined) {
        return false;
      }
      const messageId = messages.insertCustomerMessage({
        conversationId: decision.conversationId,
        channel: message.channel,
        externalMessageId: message.external_message_id,
        text: message.text,
        receivedAt: message.received_at,
      });
      decisions.insert({ ...decision, messageId });
      if (decision.replyText !== null) {
        messages.insertAssistantMessage(
          decision.conversationId,
          message.channel,
          decision.replyText,
        );
      }
      if (decision.action === 'escalate') {
        conversations.setStatus(decision.conversationId, 'human');
      }
      return true;
    })();
  }
}

async function timed<T>(
  stages: Record<string, number>,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    stages[name] = Math.round(performance.now() - start);
  }
}

function toResponse(
  decision: Pick<
    DecisionRecord,
    'conversationId' | 'action' | 'replyText' | 'reasons' | 'intent' | 'confidence' | 'citations'
  >,
): PipelineResponse {
  return {
    conversation_id: decision.conversationId,
    action: decision.action,
    reply_text: decision.replyText,
    reasons: decision.reasons,
    intent: decision.intent,
    confidence: decision.confidence,
    citations: decision.citations,
  };
}
