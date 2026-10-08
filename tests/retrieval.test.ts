import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KnowledgeBase, parseArticle } from '../src/knowledge/knowledge-base.js';
import { Bm25Index } from '../src/retrieval/bm25.js';
import { Retriever } from '../src/retrieval/retriever.js';
import { tokenize } from '../src/retrieval/tokenizer.js';

const knowledge = KnowledgeBase.loadFromDirectory(resolve(import.meta.dirname, '../knowledge'));

describe('tokenize', () => {
  it('drops stopwords and maps chat abbreviations and English terms to knowledge-base words', () => {
    expect(tokenize('Kak, brp HRG pkt-nya?')).toEqual(['brp', 'harga', 'paket']);
    expect(tokenize('What is the package price?')).toEqual(['paket', 'harga']);
  });

  it('strips accents and treats "%" like "persen"', () => {
    expect(tokenize('DP 30% café')).toEqual(['dp', '30', 'persen', 'cafe']);
  });
});

describe('Bm25Index', () => {
  const index = new Bm25Index([
    { id: 'prices', text: 'harga paket harga dekorasi' },
    { id: 'payment', text: 'metode bayar transfer qris' },
    { id: 'mixed', text: 'harga transport area bekasi jakarta depok bogor tangerang karawang' },
  ]);

  it('ranks the document with the highest term frequency first', () => {
    expect(index.search('harga', 3).map((hit) => hit.id)).toEqual(['prices', 'mixed']);
  });

  it('gives a rarer term more weight than a common one', () => {
    const [top] = index.search('harga qris', 3);
    expect(top?.id).toBe('payment');
  });

  it('returns nothing when no query term occurs in the corpus', () => {
    expect(index.search('catering', 3)).toEqual([]);
  });
});

describe('Retriever over the sample knowledge base', () => {
  const retriever = new Retriever(knowledge, { minScore: 2.5, topK: 3 });

  it.each([
    ['kak brp harga paket anggrek?', 'paket-dan-harga'],
    ['ongkir ke tangerang selatan berapa?', 'area-layanan'],
    ['bisa bayar pake qris ga kak?', 'metode-pembayaran'],
    ['kru datang jam berapa untuk pemasangan?', 'timeline-pemasangan'],
    ['do you cover Depok?', 'area-layanan'],
    ['warna tema bisa custom?', 'tema-kustom-dan-tambahan'],
  ])('"%s" ranks %s first', (query, expected) => {
    expect(retriever.retrieve(query)[0]?.article.id).toBe(expected);
  });

  it('returns nothing for topics the knowledge base does not cover', () => {
    expect(retriever.retrieve('kak catering juga ada?')).toEqual([]);
    expect(retriever.retrieve('jual baju pengantin ga')).toEqual([]);
  });

  it('drops hits below the minimum score', () => {
    const strict = new Retriever(knowledge, { minScore: 100, topK: 3 });
    expect(strict.retrieve('kak brp harga paket anggrek?')).toEqual([]);
  });
});

describe('parseArticle', () => {
  it('requires a title heading and a slug id', () => {
    expect(parseArticle('faq-one', '# Title\n\nBody text')).toEqual({
      id: 'faq-one',
      title: 'Title',
      body: 'Body text',
    });
    expect(() => parseArticle('faq-one', 'no heading')).toThrow(/heading/);
    expect(() => parseArticle('Bad Id', '# Title')).toThrow(/Invalid article id/);
  });
});
