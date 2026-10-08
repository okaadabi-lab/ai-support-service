import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface Article {
  id: string;
  title: string;
  body: string;
}

const ARTICLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class KnowledgeBase {
  private readonly byId: Map<string, Article>;

  constructor(readonly articles: Article[]) {
    this.byId = new Map(articles.map((article) => [article.id, article]));
  }

  get(id: string): Article | undefined {
    return this.byId.get(id);
  }

  static loadFromDirectory(directory: string): KnowledgeBase {
    const files = readdirSync(directory)
      .filter((file) => file.endsWith('.md'))
      .sort();
    const articles = files.map((file) =>
      parseArticle(basename(file, '.md'), readFileSync(join(directory, file), 'utf8')),
    );
    if (articles.length === 0) {
      throw new Error(`No knowledge articles found in ${directory}`);
    }
    return new KnowledgeBase(articles);
  }
}

export function parseArticle(id: string, markdown: string): Article {
  if (!ARTICLE_ID.test(id)) {
    throw new Error(`Invalid article id "${id}": use lowercase words separated by hyphens`);
  }
  const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n');
  const heading = lines[0]?.match(/^#\s+(.+)$/);
  if (!heading?.[1]) {
    throw new Error(`Article "${id}" must start with a "# Title" heading`);
  }
  return { id, title: heading[1].trim(), body: lines.slice(1).join('\n').trim() };
}
