import { afterEach, describe, expect, it } from 'vitest';
import { estimateTokens, trimHistory } from '../src/pipeline/history.js';
import type { HistoryTurn } from '../src/pipeline/types.js';
import { createTestApp, type TestApp } from './helpers.js';

describe('trimHistory', () => {
  const turn = (role: HistoryTurn['role'], chars: number, tag: string): HistoryTurn => ({
    role,
    text: tag.padEnd(chars, '.'),
  });

  it('estimates tokens as ceil(characters / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('keeps the most recent turns that fit the budget, oldest first', () => {
    const turns = [
      turn('customer', 40, 'a'),
      turn('assistant', 40, 'b'),
      turn('customer', 40, 'c'),
      turn('assistant', 40, 'd'),
    ];
    expect(trimHistory(turns, 25).map((t) => t.text[0])).toEqual(['c', 'd']);
  });

  it('stops at the first turn that does not fit instead of skipping over it', () => {
    const turns = [turn('customer', 4, 'a'), turn('assistant', 400, 'b'), turn('customer', 4, 'c')];
    expect(trimHistory(turns, 20).map((t) => t.text[0])).toEqual(['c']);
  });

  it('returns no history for a zero budget', () => {
    expect(trimHistory([turn('customer', 4, 'a')], 0)).toEqual([]);
  });
});

describe('history sent to the model', () => {
  let ctx: TestApp;
  afterEach(() => ctx.app.close());

  it('includes earlier turns of the same conversation within the token budget only', async () => {
    ctx = await createTestApp({ HISTORY_TOKEN_BUDGET: '60' });
    const customer = { channel: 'instagram', customer_id: 'ig-history' };
    await ctx.send({ ...customer, text: `OLDEST ${'x'.repeat(400)} kak brp harga paket melati?` });
    await ctx.send({ ...customer, text: 'NEWER bisa bayar pake qris?' });
    await ctx.send({ ...customer, text: 'NEWEST ongkir ke depok berapa?' });

    const lastPrompt = ctx.provider.callsFor('classify_message').at(-1)?.messages[0]?.content ?? '';
    const historyBlock = lastPrompt.split('</conversation_history>')[0] ?? '';
    expect(historyBlock).toContain('NEWER');
    expect(historyBlock).not.toContain('OLDEST');
    expect(lastPrompt).toContain('<latest_customer_message>\nNEWEST');
  });
});
