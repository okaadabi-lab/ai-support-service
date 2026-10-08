import type { Article, KnowledgeBase } from '../knowledge/knowledge-base.js';
import { Bm25Index } from './bm25.js';

export interface RetrievedArticle {
  article: Article;
  score: number;
}

export class Retriever {
  private readonly index: Bm25Index;

  constructor(
    private readonly knowledge: KnowledgeBase,
    private readonly options: { minScore: number; topK: number },
  ) {
    // The title is indexed twice so that an article's subject outweighs incidental mentions.
    this.index = new Bm25Index(
      knowledge.articles.map((article) => ({
        id: article.id,
        text: `${article.title}\n${article.title}\n${article.body}`,
      })),
    );
  }

  retrieve(query: string): RetrievedArticle[] {
    return this.index
      .search(query, this.options.topK)
      .filter((hit) => hit.score >= this.options.minScore)
      .flatMap((hit) => {
        const article = this.knowledge.get(hit.id);
        return article ? [{ article, score: round(hit.score) }] : [];
      });
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
