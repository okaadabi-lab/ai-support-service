import type { Db } from '../db/database.js';
import type { Action, ClassifierSource, Intent, Language, Reason } from '../pipeline/types.js';

export interface Citation {
  article_id: string;
  title: string;
}

export interface RetrievedRef {
  article_id: string;
  score: number;
}

export interface DecisionRecord {
  messageId: number;
  conversationId: string;
  action: Action;
  replyText: string | null;
  reasons: Reason[];
  intent: Intent | null;
  language: Language | null;
  classifierSource: ClassifierSource;
  classifierConfidence: number | null;
  answerConfidence: number | null;
  confidence: number | null;
  citations: Citation[];
  retrieved: RetrievedRef[];
  classifyPrompt: string | null;
  answerPrompt: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  stageLatencies: Record<string, number>;
}

export interface StoredDecision extends DecisionRecord {
  id: number;
  createdAt: string;
}

interface DecisionRow {
  id: number;
  message_id: number;
  conversation_id: string;
  action: Action;
  reply_text: string | null;
  reasons: string;
  intent: Intent | null;
  language: Language | null;
  classifier_source: ClassifierSource;
  classifier_confidence: number | null;
  answer_confidence: number | null;
  confidence: number | null;
  citations: string;
  retrieved: string;
  classify_prompt: string | null;
  answer_prompt: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  stage_latencies: string;
  created_at: string;
}

export class DecisionRepository {
  constructor(private readonly db: Db) {}

  insert(decision: DecisionRecord): number {
    const result = this.db
      .prepare(
        `INSERT INTO decisions (
           message_id, conversation_id, action, reply_text, reasons, intent, language,
           classifier_source, classifier_confidence, answer_confidence, confidence, citations,
           retrieved, classify_prompt, answer_prompt, model, input_tokens, output_tokens,
           estimated_cost_usd, latency_ms, stage_latencies
         ) VALUES (
           @messageId, @conversationId, @action, @replyText, @reasons, @intent, @language,
           @classifierSource, @classifierConfidence, @answerConfidence, @confidence, @citations,
           @retrieved, @classifyPrompt, @answerPrompt, @model, @inputTokens, @outputTokens,
           @estimatedCostUsd, @latencyMs, @stageLatencies
         )`,
      )
      .run({
        ...decision,
        reasons: JSON.stringify(decision.reasons),
        citations: JSON.stringify(decision.citations),
        retrieved: JSON.stringify(decision.retrieved),
        stageLatencies: JSON.stringify(decision.stageLatencies),
      });
    return Number(result.lastInsertRowid);
  }

  findByMessageId(messageId: number): StoredDecision | undefined {
    const row = this.db.prepare('SELECT * FROM decisions WHERE message_id = ?').get(messageId) as
      DecisionRow | undefined;
    return row ? toDecision(row) : undefined;
  }

  listByConversation(conversationId: string): StoredDecision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions WHERE conversation_id = ? ORDER BY id')
      .all(conversationId) as DecisionRow[];
    return rows.map(toDecision);
  }
}

function toDecision(row: DecisionRow): StoredDecision {
  return {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    action: row.action,
    replyText: row.reply_text,
    reasons: JSON.parse(row.reasons) as Reason[],
    intent: row.intent,
    language: row.language,
    classifierSource: row.classifier_source,
    classifierConfidence: row.classifier_confidence,
    answerConfidence: row.answer_confidence,
    confidence: row.confidence,
    citations: JSON.parse(row.citations) as Citation[],
    retrieved: JSON.parse(row.retrieved) as RetrievedRef[],
    classifyPrompt: row.classify_prompt,
    answerPrompt: row.answer_prompt,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    latencyMs: row.latency_ms,
    stageLatencies: JSON.parse(row.stage_latencies) as Record<string, number>,
    createdAt: row.created_at,
  };
}
