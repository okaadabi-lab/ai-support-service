import { describe, expect, it } from 'vitest';
import type { Article } from '../src/knowledge/knowledge-base.js';
import { extractAmounts, parseLocalizedNumber } from '../src/pipeline/amounts.js';
import { OutputValidator } from '../src/pipeline/validator.js';

const prices: Article = {
  id: 'paket-dan-harga',
  title: 'Paket dekorasi dan harga',
  body: 'Paket Melati: Rp 4.500.000. Paket Anggrek: Rp 12.500.000. DP 30% untuk mengunci tanggal.',
};
const areas: Article = {
  id: 'area-layanan',
  title: 'Area layanan',
  body: 'Biaya transport Rp 350.000 untuk Depok.',
};

const validator = new OutputValidator({ minChars: 2, maxChars: 200 });
const answer = (reply: string, cited: string[] = ['paket-dan-harga'], confidence = 0.9) => ({
  reply,
  cited_article_ids: cited,
  confidence,
});
const codes = (result: ReturnType<OutputValidator['validate']>) =>
  result.issues.map((issue) => issue.code);

describe('extractAmounts', () => {
  it('normalises Indonesian and English money formats to the same key', () => {
    for (const text of [
      'Rp 4.500.000',
      'Rp4,5 juta',
      '4.5jt',
      'IDR 4,500,000',
      '4500 ribu',
      '4.500.000',
    ]) {
      expect(extractAmounts(text), text).toEqual(new Set(['idr:4500000']));
    }
  });

  it('extracts percentages and ignores small bare numbers such as days and hours', () => {
    expect(extractAmounts('DP 30% atau 30 persen, kru datang 4 jam sebelum, H-14')).toEqual(
      new Set(['pct:30']),
    );
  });

  it('parses grouped and decimal numbers', () => {
    expect(parseLocalizedNumber('12.500.000')).toBe(12_500_000);
    expect(parseLocalizedNumber('1,234,567.50')).toBe(1_234_567.5);
    expect(parseLocalizedNumber('2,5')).toBe(2.5);
  });
});

describe('OutputValidator', () => {
  it('accepts a grounded reply', () => {
    const result = validator.validate(answer('Paket Melati harganya Rp 4,5 juta kak, DP 30% ya.'), [
      prices,
    ]);
    expect(result).toMatchObject({ ok: true, issues: [] });
  });

  it('rejects output that does not match the schema', () => {
    const result = validator.validate({ reply: 'hi', confidence: 2 }, [prices]);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['validation_schema']);
  });

  it('blocks a hallucinated price that is not in any cited article', () => {
    const result = validator.validate(answer('Paket Melati cuma Rp 3.900.000 kak!'), [prices]);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { code: 'validation_unsupported_amount', detail: 'idr:3900000' },
    ]);
  });

  it('blocks a price that exists only in a retrieved article the reply did not cite', () => {
    const result = validator.validate(answer('Ongkir ke Depok Rp 350.000 kak.'), [prices, areas]);
    expect(codes(result)).toEqual(['validation_unsupported_amount']);
  });

  it('blocks a citation that was not part of the retrieved set', () => {
    const result = validator.validate(
      answer('Paket Melati Rp 4.500.000 kak.', ['paket-dan-harga', 'invented-article']),
      [prices],
    );
    expect(result.issues).toEqual([
      { code: 'validation_citation_not_retrieved', detail: 'invented-article' },
    ]);
  });

  it('requires at least one citation', () => {
    expect(codes(validator.validate(answer('Bisa kak.', []), [prices]))).toEqual([
      'validation_no_citations',
    ]);
  });

  it('enforces reply length bounds after trimming', () => {
    expect(codes(validator.validate(answer('   k  '), [prices]))).toEqual([
      'validation_reply_too_short',
    ]);
    expect(codes(validator.validate(answer('a'.repeat(201)), [prices]))).toEqual([
      'validation_reply_too_long',
    ]);
  });

  it.each([
    ['Tenang kak, DP pasti dikembalikan penuh.', 'guaranteed_refund'],
    ['Refund kakak dijamin cair minggu ini.', 'guaranteed_refund'],
    ["Don't worry, we guarantee a full refund.", 'guaranteed_refund'],
    ['Tenang kak, 100% refund kok.', 'guaranteed_refund'],
    ['Tanggal acara kakak sudah dikunci.', 'confirmed_booking'],
    ['Tanggalnya sudah kami kunci ya kak.', 'confirmed_booking'],
    ["Great news, I've rescheduled your event.", 'confirmed_booking'],
    ['Khusus kakak kami kasih diskon 10%.', 'discount_offer'],
  ])('blocks the forbidden promise in "%s"', (reply, rule) => {
    const result = validator.validate(answer(reply), [prices]);
    expect(result.issues).toContainEqual({ code: 'validation_forbidden_promise', detail: rule });
  });

  it.each([
    'Refund diperiksa dan diputuskan oleh admin sesuai kontrak ya kak.',
    'Kalau sudah ganti tanggal, kabari admin ya kak.',
    'Admin akan konfirmasi tanggalnya ya kak.',
  ])('allows policy wording that does not make a commitment: "%s"', (reply) => {
    expect(validator.validate(answer(reply), [prices]).ok).toBe(true);
  });
});
