import { tokenize } from './tokenizer.js';

export interface IndexedDocument {
  id: string;
  text: string;
}

export interface ScoredDocument {
  id: string;
  score: number;
}

export interface Bm25Options {
  k1: number;
  b: number;
}

/**
 * Okapi BM25 over a small, static corpus. The whole index lives in memory;
 * for a few dozen articles this is simpler and faster than any external search engine.
 */
export class Bm25Index {
  private readonly termFrequencies: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private readonly ids: string[] = [];
  private readonly averageLength: number;

  constructor(
    documents: IndexedDocument[],
    private readonly options: Bm25Options = { k1: 1.2, b: 0.75 },
  ) {
    for (const doc of documents) {
      const tokens = tokenize(doc.text);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      for (const term of frequencies.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      this.ids.push(doc.id);
      this.termFrequencies.push(frequencies);
      this.lengths.push(tokens.length);
    }
    const totalLength = this.lengths.reduce((sum, length) => sum + length, 0);
    this.averageLength = documents.length > 0 ? totalLength / documents.length : 0;
  }

  search(query: string, limit: number): ScoredDocument[] {
    const queryTerms = [...new Set(tokenize(query))];
    const results: ScoredDocument[] = [];
    for (const [index, frequencies] of this.termFrequencies.entries()) {
      let score = 0;
      for (const term of queryTerms) {
        const tf = frequencies.get(term);
        if (tf === undefined) {
          continue;
        }
        score += this.idf(term) * this.saturatedTf(tf, this.lengths[index] ?? 0);
      }
      const id = this.ids[index];
      if (score > 0 && id !== undefined) {
        results.push({ id, score });
      }
    }
    return results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }

  private idf(term: string): number {
    const n = this.ids.length;
    const df = this.documentFrequency.get(term) ?? 0;
    // The +1 inside the log (Lucene variant) keeps IDF positive for terms present in most documents.
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private saturatedTf(tf: number, length: number): number {
    const { k1, b } = this.options;
    const norm = this.averageLength > 0 ? length / this.averageLength : 1;
    return (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * norm));
  }
}
