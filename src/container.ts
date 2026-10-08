import { ApiKeyAuthenticator } from './auth/api-keys.js';
import type { AppConfig } from './config.js';
import { type Db, openDatabase } from './db/database.js';
import { KnowledgeBase } from './knowledge/knowledge-base.js';
import { AnthropicProvider } from './llm/anthropic-provider.js';
import { FakeProvider } from './llm/fake-provider.js';
import { PromptRegistry } from './llm/prompts.js';
import type { LlmProvider } from './llm/provider.js';
import type { RetryOptions } from './llm/retry.js';
import { IntentClassifier } from './pipeline/classifier.js';
import { MessagePipeline } from './pipeline/message-pipeline.js';
import { EscalationPolicy } from './pipeline/policy.js';
import { Responder } from './pipeline/responder.js';
import { OutputValidator } from './pipeline/validator.js';
import { ApiKeyRepository } from './repositories/api-key-repository.js';
import { ConversationRepository } from './repositories/conversation-repository.js';
import { DecisionRepository } from './repositories/decision-repository.js';
import { MessageRepository } from './repositories/message-repository.js';
import { MetricsRepository } from './repositories/metrics-repository.js';
import { Retriever } from './retrieval/retriever.js';

export interface Container {
  config: AppConfig;
  db: Db;
  provider: LlmProvider;
  apiKeys: ApiKeyRepository;
  authenticator: ApiKeyAuthenticator;
  conversations: ConversationRepository;
  messages: MessageRepository;
  decisions: DecisionRepository;
  metrics: MetricsRepository;
  pipeline: MessagePipeline;
}

export interface ContainerOverrides {
  db?: Db;
  provider?: LlmProvider;
  sleep?: RetryOptions['sleep'];
}

export function createProvider(config: AppConfig): LlmProvider {
  if (config.llm.provider === 'anthropic') {
    if (!config.llm.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
    }
    return new AnthropicProvider(config.llm.anthropicApiKey, config.llm.model);
  }
  return new FakeProvider();
}

export function retryOptionsFrom(config: AppConfig, sleep?: RetryOptions['sleep']): RetryOptions {
  return {
    maxAttempts: config.llm.maxAttempts,
    timeoutMs: config.llm.timeoutMs,
    baseDelayMs: config.llm.retryBaseDelayMs,
    maxDelayMs: config.llm.retryMaxDelayMs,
    ...(sleep ? { sleep } : {}),
  };
}

export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const db = overrides.db ?? openDatabase(config.databasePath);
  const provider = overrides.provider ?? createProvider(config);
  const prompts = new PromptRegistry(config.promptsDir);
  const knowledge = KnowledgeBase.loadFromDirectory(config.knowledgeDir);
  const retry = retryOptionsFrom(config, overrides.sleep);

  const apiKeys = new ApiKeyRepository(db);
  const conversations = new ConversationRepository(db);
  const messages = new MessageRepository(db);
  const decisions = new DecisionRepository(db);

  const pipeline = new MessagePipeline({
    db,
    conversations,
    messages,
    decisions,
    classifier: new IntentClassifier({
      provider,
      prompts,
      promptVersion: config.prompts.classifyVersion,
      retry,
      maxOutputTokens: config.llm.maxOutputTokens,
    }),
    retriever: new Retriever(knowledge, config.retrieval),
    responder: new Responder({
      provider,
      prompts,
      promptVersion: config.prompts.answerVersion,
      retry,
      maxOutputTokens: config.llm.maxOutputTokens,
    }),
    validator: new OutputValidator(config.reply),
    policy: new EscalationPolicy(config.policy),
    model: provider.model,
    pricing: {
      inputPerMTok: config.llm.priceInputPerMTok,
      outputPerMTok: config.llm.priceOutputPerMTok,
    },
    historyTokenBudget: config.historyTokenBudget,
    logCustomerText: config.logCustomerText,
  });

  return {
    config,
    db,
    provider,
    apiKeys,
    authenticator: new ApiKeyAuthenticator(apiKeys),
    conversations,
    messages,
    decisions,
    metrics: new MetricsRepository(db),
    pipeline,
  };
}
