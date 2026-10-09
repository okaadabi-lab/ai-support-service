import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Article, KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { extractAmounts, parseLocalizedNumber } from '../src/pipeline/amounts.js';
import { FORBIDDEN_PROMISES, OutputValidator } from '../src/pipeline/validator.js';
import { normalizeText } from '../src/retrieval/tokenizer.js';

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
      '4,5jt',
      'Rp4.500.000,-',
      'IDR 4.5 million',
      '4500000',
    ]) {
      expect(extractAmounts(text), text).toEqual(new Set(['idr:4500000']));
    }
  });

  it('reads approximations, billions and dollar amounts', () => {
    expect(extractAmounts('sekitar 5 jutaan, atau 450rban')).toEqual(
      new Set(['idr:5000000', 'idr:450000']),
    );
    expect(extractAmounts('Rp 1,5 miliar')).toEqual(new Set(['idr:1500000000']));
    expect(extractAmounts('$300, USD 300 or 300 dollars')).toEqual(new Set(['usd:300']));
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

  it.each(['Paket Melati sekitar 5 jutaan kak.', 'Paket Melati USD 300 kak.'])(
    'blocks an invented amount written as "%s"',
    (reply) => {
      expect(codes(validator.validate(answer(reply), [prices]))).toEqual([
        'validation_unsupported_amount',
      ]);
    },
  );

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
    ['Sure! We will give you a full refund.', 'guaranteed_refund'],
    ['Of course, you will get a full refund.', 'guaranteed_refund'],
    ['Your refund has been approved.', 'guaranteed_refund'],
    ['Refund kakak sudah disetujui ya.', 'guaranteed_refund'],
    ['Siap kak, kami akan refund penuh uang kakak.', 'guaranteed_refund'],
    ['Baik kak, uang kakak akan kami kembalikan semua.', 'guaranteed_refund'],
    ['DP kakak akan dikembalikan full.', 'guaranteed_refund'],
    ['Dana kakak sudah kami transfer balik.', 'guaranteed_refund'],
    ['I promise everything will be fine.', 'explicit_promise'],
    ['Your booking is confirmed for 12 December.', 'confirmed_booking'],
    ['Booking kakak sudah fix ya.', 'confirmed_booking'],
    ['Tanggal 12 Desember sudah kami catat ya kak.', 'confirmed_booking'],
    ['Your date is locked in.', 'confirmed_booking'],
    ['Kami kasih potongan ya kak.', 'discount_offer'],
    ['Gratis ongkir khusus kakak.', 'discount_offer'],
  ])('blocks the forbidden promise in "%s"', (reply, rule) => {
    const result = validator.validate(answer(reply), [prices]);
    expect(result.issues).toContainEqual({ code: 'validation_forbidden_promise', detail: rule });
  });

  it.each([
    'Refund diperiksa dan diputuskan oleh admin sesuai kontrak ya kak.',
    'Kalau sudah ganti tanggal, kabari admin ya kak.',
    'Admin akan konfirmasi tanggalnya ya kak.',
    'Jika kami yang membatalkan, seluruh pembayaran dikembalikan penuh kak.',
    'Tanggal baru dianggap terkunci setelah DP diterima dan dikonfirmasi admin kak.',
  ])('allows policy wording that does not make a commitment: "%s"', (reply) => {
    expect(validator.validate(answer(reply), [prices]).ok).toBe(true);
  });

  it('lets every sentence of the knowledge base through the forbidden-promise rules', () => {
    const knowledge = KnowledgeBase.loadFromDirectory(resolve(import.meta.dirname, '../knowledge'));
    const sentences = knowledge.articles.flatMap((article) =>
      `${article.title}\n${article.body}`.split(/(?<=[.!?:])\s+|\n+/),
    );
    expect(sentences.length).toBeGreaterThan(50);
    const matches = sentences.flatMap((sentence) =>
      FORBIDDEN_PROMISES.filter((rule) => rule.pattern.test(normalizeText(sentence))).map(
        (rule) => `${rule.id}: ${sentence}`,
      ),
    );
    expect(matches).toEqual([]);
  });
});
