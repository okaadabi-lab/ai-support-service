import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { percentile } from '../src/repositories/metrics-repository.js';
import { createTestApp, type TestApp } from './helpers.js';

describe('percentile', () => {
  it('uses the nearest-rank method', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('GET /v1/metrics', () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.app.close());

  const getMetrics = async (query = '') => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/metrics${query}`,
      headers: { authorization: `Bearer ${ctx.adminKey}` },
    });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  };

  it('aggregates intents, escalation rate with reasons, latency, tokens and cost', async () => {
    const classified = (intent: string, confidence = 0.9) => ({
      input: { intent, confidence, language: 'id' },
    });
    ctx.provider.enqueue(
      'classify_message',
      classified('pricing_question'),
      classified('pricing_question'),
      classified('complaint'),
      classified('other', 0.3),
      classified('human_request'),
    );
    await ctx.send({ customer_id: 'm1', text: 'kak brp harga paket anggrek?' });
    await ctx.send({ customer_id: 'm2', text: 'harga paket melati berapa?' });
    await ctx.send({ customer_id: 'm3', text: 'kecewa' });
    await ctx.send({ customer_id: 'm4', text: 'hmm' });
    await ctx.send({ customer_id: 'm5', text: 'admin dong' });
    await ctx.send({ customer_id: 'm5', text: 'halo?' });

    const decisions = ['m1', 'm2', 'm3', 'm4', 'm5'].flatMap((customer) => {
      const conversation = ctx.app.container.conversations.upsert('whatsapp', customer, null);
      return ctx.app.container.decisions.listByConversation(conversation.id);
    });
    const totalInput = decisions.reduce((sum, d) => sum + d.inputTokens, 0);
    const totalCost = decisions.reduce((sum, d) => sum + d.estimatedCostUsd, 0);

    const { statusCode, body } = await getMetrics();

    expect(statusCode).toBe(200);
    expect(body).toMatchObject({
      total_decisions: 6,
      actions: { reply: 2, escalate: 3, none: 1 },
      escalation_rate: 0.6,
      escalation_reasons: {
        intent_complaint: 1,
        intent_human_request: 1,
        low_classifier_confidence: 1,
      },
      intents: { pricing_question: 2, complaint: 1, other: 1, human_request: 1 },
      classifier_fallback_count: 0,
    });
    expect((body.tokens as { input: number }).input).toBe(totalInput);
    expect(body.estimated_cost_usd).toBeCloseTo(totalCost, 6);
    const latency = body.latency_ms as { p50: number; p95: number };
    expect(latency.p95).toBeGreaterThanOrEqual(latency.p50);
  });

  it('only counts decisions inside the requested window', async () => {
    await ctx.send();
    const { body } = await getMetrics('?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z');
    expect(body).toMatchObject({
      total_decisions: 0,
      escalation_rate: null,
      latency_ms: { p50: null, p95: null },
    });
  });

  it('rejects an inverted window', async () => {
    const { statusCode } = await getMetrics('?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z');
    expect(statusCode).toBe(400);
  });
});
