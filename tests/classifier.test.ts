import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { PromptRegistry } from '../src/llm/prompts.js';
import { LlmError } from '../src/llm/provider.js';
import { CLASSIFY_TOOL, IntentClassifier } from '../src/pipeline/classifier.js';
import { classifyByKeywords, detectLanguage } from '../src/pipeline/keyword-classifier.js';

function classifierWith(provider: FakeProvider, maxAttempts = 2) {
  return new IntentClassifier({
    provider,
    prompts: new PromptRegistry(resolve(import.meta.dirname, '../prompts')),
    promptVersion: 'classify.v1',
    retry: {
      maxAttempts,
      timeoutMs: 20,
      baseDelayMs: 0,
      maxDelayMs: 0,
      sleep: () => Promise.resolve(),
    },
    maxOutputTokens: 256,
  });
}

describe('IntentClassifier', () => {
  it('forces the classify tool with a JSON schema and returns the validated result', async () => {
    const provider = new FakeProvider().enqueue('classify_message', {
      input: { intent: 'pricing_question', confidence: 0.93, language: 'id' },
    });
    const result = await classifierWith(provider).classify('brp hrg pkt melati', []);

    expect(result).toMatchObject({
      intent: 'pricing_question',
      confidence: 0.93,
      source: 'llm',
      promptVersion: 'classify.v1',
    });
    const call = provider.calls[0];
    expect(call?.tool.name).toBe(CLASSIFY_TOOL.name);
    expect(call?.tool.inputSchema).not.toHaveProperty('$schema');
    expect(call?.tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['intent', 'confidence', 'language'],
      properties: {
        intent: { enum: expect.arrayContaining(['refund_request', 'other']) as unknown },
      },
    });
  });

  it('falls back to keywords when the call times out on every attempt', async () => {
    const provider = new FakeProvider().enqueue('classify_message', { hang: true }, { hang: true });
    const result = await classifierWith(provider).classify('saya mau refund DP', []);

    expect(result).toMatchObject({
      intent: 'refund_request',
      source: 'fallback',
      error: 'timeout',
      attempts: 2,
    });
  });

  it('falls back when the tool input fails schema validation', async () => {
    const provider = new FakeProvider().enqueue('classify_message', {
      input: { intent: 'buy_now', confidence: 0.99, language: 'id' },
    });
    const result = await classifierWith(provider).classify('halo kak', []);
    expect(result).toMatchObject({
      source: 'fallback',
      error: 'invalid_tool_input',
      intent: 'greeting',
    });
  });

  it('retries a 5xx and then uses the model result', async () => {
    const provider = new FakeProvider().enqueue(
      'classify_message',
      { error: LlmError.fromStatus(500, 'server error') },
      { input: { intent: 'complaint', confidence: 0.8, language: 'en' } },
    );
    const result = await classifierWith(provider).classify('the flowers were wilted', []);
    expect(result).toMatchObject({ intent: 'complaint', source: 'llm', attempts: 2 });
  });
});

describe('classifyByKeywords', () => {
  it.each([
    ['min aku mau minta DP ku dibalikin', 'refund_request'],
    ['bisa ngomong sama admin aja?', 'human_request'],
    ['kecewa banget bunganya layu', 'complaint'],
    ['acaranya mau diundur bisa?', 'booking_change'],
    ['tgl 12 maret masih kosong?', 'availability_question'],
    ['brp harga paket melati', 'pricing_question'],
    ['halooo kak', 'greeting'],
    ['kalian buka lowongan kerja?', 'other'],
  ])('"%s" -> %s', (text, intent) => {
    expect(classifyByKeywords(text).intent).toBe(intent);
  });

  it('prefers the intent that must reach a human when several match', () => {
    expect(classifyByKeywords('harga mahal, kecewa, saya mau refund').intent).toBe(
      'refund_request',
    );
  });

  it('never reports high confidence', () => {
    expect(classifyByKeywords('brp harga paket').confidence).toBeLessThan(0.6);
  });

  it('detects English and Indonesian', () => {
    expect(detectLanguage('how much is the package')).toBe('en');
    expect(detectLanguage('kak berapa harga paketnya')).toBe('id');
  });
});
