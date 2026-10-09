import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { generateApiKey } from '../src/auth/api-keys.js';
import { type AppConfig, loadConfig } from '../src/config.js';
import { type Db, openDatabase } from '../src/db/database.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import type { IncomingMessage, PipelineResponse } from '../src/pipeline/message-pipeline.js';
import { ApiKeyRepository, type Scope } from '../src/repositories/api-key-repository.js';

const root = resolve(import.meta.dirname, '..');

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: ':memory:',
    KNOWLEDGE_DIR: resolve(root, 'knowledge'),
    PROMPTS_DIR: resolve(root, 'prompts'),
    LLM_PROVIDER: 'fake',
    LLM_TIMEOUT_MS: '200',
    LLM_PRICE_INPUT_PER_MTOK: '1',
    LLM_PRICE_OUTPUT_PER_MTOK: '5',
    ...env,
  });
}

export interface TestApp {
  app: FastifyInstance;
  provider: FakeProvider;
  writerKey: string;
  adminKey: string;
  createKey: (scopes: Scope[]) => string;
  send: (overrides?: Partial<IncomingMessage>, key?: string) => Promise<SendResult>;
}

export interface SendResult {
  statusCode: number;
  headers: Record<string, unknown>;
  body: PipelineResponse & { error?: { code: string } };
}

let sequence = 0;

export function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  sequence++;
  return {
    channel: 'whatsapp',
    external_message_id: `wamid.test-${sequence}`,
    customer_id: `62812000${sequence}`,
    customer_name: 'Rina',
    text: 'kak brp harga paket anggrek?',
    received_at: '2026-10-09T03:00:00Z',
    ...overrides,
  };
}

export async function createTestApp(
  env: Record<string, string> = {},
  db: Db = openDatabase(':memory:'),
): Promise<TestApp> {
  const config = testConfig(env);
  const provider = new FakeProvider();
  const app = await buildApp(config, {
    db,
    provider,
    logger: false,
    sleep: () => Promise.resolve(),
  });
  const keys = new ApiKeyRepository(db);

  const createKey = (scopes: Scope[]): string => {
    const key = generateApiKey();
    keys.insert(`test-${scopes.join('+')}`, key.prefix, key.hash, scopes);
    return key.plaintext;
  };
  const writerKey = createKey(['messages:write']);
  const adminKey = createKey(['admin:read']);

  const send = async (overrides: Partial<IncomingMessage> = {}, key = writerKey) => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${key}` },
      payload: message(overrides),
    });
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.json<SendResult['body']>(),
    };
  };

  return { app, provider, writerKey, adminKey, createKey, send };
}
