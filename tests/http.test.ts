import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey } from '../src/auth/api-keys.js';
import { registerApiKeyAuth } from '../src/http/auth-plugin.js';
import { createTestApp, message, type TestApp } from './helpers.js';

describe('HTTP API', () => {
  let ctx: TestApp;
  afterEach(() => ctx.app.close());

  describe('authentication and scopes', () => {
    it('rejects requests without a valid bearer key', async () => {
      ctx = await createTestApp();
      const forged = generateApiKey().plaintext;
      for (const authorization of [
        undefined,
        'Bearer nope',
        `Bearer ${forged}`,
        `Basic ${ctx.writerKey}`,
      ]) {
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/v1/messages',
          headers: authorization ? { authorization } : {},
          payload: message(),
        });
        expect(response.statusCode, String(authorization)).toBe(401);
        expect(response.json()).toEqual({
          error: { code: 'unauthorized', message: 'Missing or invalid API key' },
        });
      }
    });

    it('rejects a key whose secret differs from the stored hash even when the prefix matches', async () => {
      ctx = await createTestApp();
      const [, prefix] = ctx.writerKey.split('_');
      const tampered = `sup_${prefix ?? ''}_${'A'.repeat(43)}`;
      expect(hashApiKey(tampered)).not.toBe(hashApiKey(ctx.writerKey));
      const response = await ctx.send({}, tampered);
      expect(response.statusCode).toBe(401);
    });

    it('rejects a revoked key', async () => {
      ctx = await createTestApp();
      const key = ctx.createKey(['messages:write']);
      expect((await ctx.send({}, key)).statusCode).toBe(201);

      const [, prefix] = key.split('_');
      ctx.app.container.db
        .prepare("UPDATE api_keys SET revoked_at = '2026-10-09T00:00:00Z' WHERE key_prefix = ?")
        .run(prefix);
      expect((await ctx.send({}, key)).statusCode).toBe(401);
    });

    it('enforces scopes per route', async () => {
      ctx = await createTestApp();
      const { body } = await ctx.send();

      expect((await ctx.send({}, ctx.adminKey)).statusCode).toBe(403);
      const asWriter = await ctx.app.inject({
        method: 'GET',
        url: '/v1/metrics',
        headers: { authorization: `Bearer ${ctx.writerKey}` },
      });
      expect(asWriter.statusCode).toBe(403);
      expect(asWriter.json()).toMatchObject({ error: { code: 'forbidden' } });

      const asAdmin = await ctx.app.inject({
        method: 'GET',
        url: `/v1/conversations/${body.conversation_id}`,
        headers: { authorization: `Bearer ${ctx.adminKey}` },
      });
      expect(asAdmin.statusCode).toBe(200);
    });

    it('refuses to register an authenticated route that declares no scope', async () => {
      ctx = await createTestApp();
      const app = Fastify({ logger: false });
      registerApiKeyAuth(app, ctx.app.container.authenticator);
      expect(() => app.get('/v1/unscoped', async () => ({}))).toThrow(/must declare config.scope/);
      await app.close();
    });

    it('serves /health without a key', async () => {
      ctx = await createTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/health' });
      expect(response.json()).toEqual({ status: 'ok', provider: 'fake', model: 'fake-model' });
    });
  });

  describe('input validation', () => {
    it('returns structured 400 errors for an invalid message', async () => {
      ctx = await createTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { authorization: `Bearer ${ctx.writerKey}` },
        payload: { ...message(), text: '   ', received_at: 'yesterday' },
      });
      expect(response.statusCode).toBe(400);
      const { error } = response.json<{ error: { code: string; details: { path: string }[] } }>();
      expect(error.code).toBe('validation_failed');
      expect(error.details.map((detail) => detail.path).sort()).toEqual(['received_at', 'text']);
      expect(ctx.provider.calls).toHaveLength(0);
    });

    it('accepts Instagram-length message ids up to 255 characters', async () => {
      ctx = await createTestApp();
      const instagramMid = `aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx${'Q'.repeat(150)}`;
      expect((await ctx.send({ external_message_id: instagramMid })).statusCode).toBe(201);
      expect((await ctx.send({ external_message_id: 'x'.repeat(256) })).statusCode).toBe(400);
    });

    it('echoes a safe x-request-id and generates one otherwise', async () => {
      ctx = await createTestApp();
      const echoed = await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'n8n-exec-42' },
      });
      const generated = await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'bad id!' },
      });
      expect(echoed.headers['x-request-id']).toBe('n8n-exec-42');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('rate limiting', () => {
    it('limits messages per customer', async () => {
      ctx = await createTestApp({ RATE_LIMIT_PER_CUSTOMER_PER_MINUTE: '2' });
      const customer = { channel: 'whatsapp', customer_id: 'c-flood' };
      expect((await ctx.send(customer)).statusCode).toBe(201);
      expect((await ctx.send(customer)).statusCode).toBe(201);

      const limited = await ctx.send(customer);
      expect(limited.statusCode).toBe(429);
      expect(limited.body.error?.code).toBe('rate_limited');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      expect((await ctx.send({ customer_id: 'c-other' })).statusCode).toBe(201);
    });

    it('limits requests per API key across customers', async () => {
      ctx = await createTestApp({ RATE_LIMIT_PER_KEY_PER_MINUTE: '2' });
      expect((await ctx.send()).statusCode).toBe(201);
      expect((await ctx.send()).statusCode).toBe(201);
      expect((await ctx.send()).statusCode).toBe(429);

      const otherKey = ctx.createKey(['messages:write']);
      expect((await ctx.send({}, otherKey)).statusCode).toBe(201);
    });
  });

  describe('conversations', () => {
    it('returns history and decisions for a conversation', async () => {
      ctx = await createTestApp();
      const { body } = await ctx.send({ text: 'kak brp harga paket anggrek?' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/v1/conversations/${body.conversation_id}`,
        headers: { authorization: `Bearer ${ctx.adminKey}` },
      });
      const data = response.json<{
        conversation: { status: string };
        messages: { role: string }[];
        decisions: {
          action: string;
          prompts: { classify: string; answer: string };
          tokens: { input: number };
        }[];
      }>();

      expect(data.conversation.status).toBe('bot');
      expect(data.messages.map((m) => m.role)).toEqual(['customer', 'assistant']);
      expect(data.decisions[0]).toMatchObject({
        action: 'reply',
        prompts: { classify: 'classify.v1', answer: 'answer.v1' },
      });
      expect(data.decisions[0]?.tokens.input).toBeGreaterThan(0);
    });

    it('returns 404 for an unknown conversation and 400 for a malformed id', async () => {
      ctx = await createTestApp();
      const headers = { authorization: `Bearer ${ctx.adminKey}` };
      const unknown = await ctx.app.inject({
        method: 'GET',
        url: '/v1/conversations/7d0e4c34-6f1c-4b8e-9a51-2f1a0f8f0b11',
        headers,
      });
      const malformed = await ctx.app.inject({
        method: 'GET',
        url: '/v1/conversations/abc',
        headers,
      });
      expect(unknown.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(400);
    });

    it('lets an agent take over and hand the conversation back to the bot', async () => {
      ctx = await createTestApp();
      const customer = { channel: 'instagram', customer_id: 'ig-agent' };
      const { body } = await ctx.send({ ...customer, text: 'kak brp harga paket anggrek?' });
      const handoff = (status: string) =>
        ctx.app.inject({
          method: 'POST',
          url: `/v1/conversations/${body.conversation_id}/handoff`,
          headers: { authorization: `Bearer ${ctx.writerKey}` },
          payload: { status },
        });

      expect((await handoff('human')).json()).toMatchObject({ status: 'human' });
      expect((await ctx.send({ ...customer, text: 'bisa bayar pake qris?' })).body.action).toBe(
        'none',
      );

      expect((await handoff('bot')).json()).toMatchObject({ status: 'bot' });
      expect((await ctx.send({ ...customer, text: 'bisa bayar pake qris?' })).body.action).toBe(
        'reply',
      );

      expect((await handoff('robot')).statusCode).toBe(400);
    });
  });
});
