import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { generateApiKey } from '../src/auth/api-keys.js';
import { openDatabase } from '../src/db/database.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { ApiKeyRepository } from '../src/repositories/api-key-repository.js';
import { message, testConfig } from './helpers.js';
import type { FastifyInstance } from 'fastify';

async function appWithCapturedLogs(env: Record<string, string>) {
  const lines: string[] = [];
  const db = openDatabase(':memory:');
  const app = await buildApp(testConfig({ LOG_LEVEL: 'info', ...env }), {
    db,
    provider: new FakeProvider(),
    logStream: { write: (line) => lines.push(line) },
  });
  const key = generateApiKey();
  new ApiKeyRepository(db).insert('log-test', key.prefix, key.hash, ['messages:write']);
  return { app, lines, key };
}

describe('logging', () => {
  let app: FastifyInstance | undefined;
  afterEach(() => app?.close());

  it('never writes the API key, and omits customer text by default', async () => {
    const ctx = await appWithCapturedLogs({});
    app = ctx.app;
    const payload = message({ text: 'kak brp harga paket anggrek? rahasia-123' });
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${ctx.key.plaintext}`, 'x-request-id': 'req-log-1' },
      payload,
    });
    const output = ctx.lines.join('');

    expect(output).not.toContain(ctx.key.plaintext);
    expect(output).not.toContain('rahasia-123');
    const decisionLine = ctx.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === 'message decision');
    expect(decisionLine).toMatchObject({
      reqId: 'req-log-1',
      apiKeyPrefix: ctx.key.prefix,
      action: 'reply',
    });
  });

  it('includes customer text only when LOG_CUSTOMER_TEXT is enabled', async () => {
    const ctx = await appWithCapturedLogs({ LOG_CUSTOMER_TEXT: 'true' });
    app = ctx.app;
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${ctx.key.plaintext}` },
      payload: message({ text: 'kak brp harga paket anggrek? rahasia-456' }),
    });
    expect(ctx.lines.join('')).toContain('rahasia-456');
  });
});
