import { existsSync } from 'node:fs';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const promptVersion = z.string().regex(/^[a-z]+\.v\d+$/, 'expected a version id like classify.v1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8083),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_CUSTOMER_TEXT: booleanFromEnv.default(false),
    DATABASE_PATH: z.string().min(1).default('./data/support.db'),
    KNOWLEDGE_DIR: z.string().min(1).default('./knowledge'),
    PROMPTS_DIR: z.string().min(1).default('./prompts'),

    LLM_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
    ANTHROPIC_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().min(1).default('claude-haiku-5-5'),
    LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0),
    LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(16384).default(2048),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1).default(15000),
    LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    LLM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(500),
    LLM_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).default(4000),

    CLASSIFY_PROMPT_VERSION: promptVersion.default('classify.v1'),
    ANSWER_PROMPT_VERSION: promptVersion.default('answer.v1'),

    MIN_CLASSIFIER_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
    MIN_ANSWER_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
    RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).default(2.5),
    RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(10).default(3),
    HISTORY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(1500),
    REPLY_MIN_CHARS: z.coerce.number().int().min(1).default(2),
    REPLY_MAX_CHARS: z.coerce.number().int().min(20).default(700),

    RATE_LIMIT_PER_KEY_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    RATE_LIMIT_PER_CUSTOMER_PER_MINUTE: z.coerce.number().int().min(1).default(12),
  })
  .refine((env) => env.LLM_PROVIDER !== 'anthropic' || Boolean(env.ANTHROPIC_API_KEY), {
    message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
    path: ['ANTHROPIC_API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  logCustomerText: boolean;
  databasePath: string;
  knowledgeDir: string;
  promptsDir: string;
  llm: {
    provider: Env['LLM_PROVIDER'];
    anthropicApiKey: string | undefined;
    model: string;
    priceInputPerMTok: number;
    priceOutputPerMTok: number;
    maxOutputTokens: number;
    timeoutMs: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
  prompts: { classifyVersion: string; answerVersion: string };
  policy: { minClassifierConfidence: number; minAnswerConfidence: number };
  retrieval: { minScore: number; topK: number };
  historyTokenBudget: number;
  reply: { minChars: number; maxChars: number };
  rateLimit: { perKeyPerMinute: number; perCustomerPerMinute: number };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    logCustomerText: env.LOG_CUSTOMER_TEXT,
    databasePath: env.DATABASE_PATH,
    knowledgeDir: env.KNOWLEDGE_DIR,
    promptsDir: env.PROMPTS_DIR,
    llm: {
      provider: env.LLM_PROVIDER,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      model: env.LLM_MODEL,
      priceInputPerMTok: env.LLM_PRICE_INPUT_PER_MTOK,
      priceOutputPerMTok: env.LLM_PRICE_OUTPUT_PER_MTOK,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxAttempts: env.LLM_MAX_ATTEMPTS,
      retryBaseDelayMs: env.LLM_RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: env.LLM_RETRY_MAX_DELAY_MS,
    },
    prompts: {
      classifyVersion: env.CLASSIFY_PROMPT_VERSION,
      answerVersion: env.ANSWER_PROMPT_VERSION,
    },
    policy: {
      minClassifierConfidence: env.MIN_CLASSIFIER_CONFIDENCE,
      minAnswerConfidence: env.MIN_ANSWER_CONFIDENCE,
    },
    retrieval: { minScore: env.RETRIEVAL_MIN_SCORE, topK: env.RETRIEVAL_TOP_K },
    historyTokenBudget: env.HISTORY_TOKEN_BUDGET,
    reply: { minChars: env.REPLY_MIN_CHARS, maxChars: env.REPLY_MAX_CHARS },
    rateLimit: {
      perKeyPerMinute: env.RATE_LIMIT_PER_KEY_PER_MINUTE,
      perCustomerPerMinute: env.RATE_LIMIT_PER_CUSTOMER_PER_MINUTE,
    },
  };
}

/** Loads `.env` into process.env when present; real environment variables take precedence. */
export function loadEnvFile(path = '.env'): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
