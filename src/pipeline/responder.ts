import { z } from 'zod';
import type { LlmProvider } from '../llm/provider.js';
import { type PromptRegistry, renderPrompt } from '../llm/prompts.js';
import { RetryExhaustedError, type RetryOptions, withRetry } from '../llm/retry.js';
import type { RetrievedArticle } from '../retrieval/retriever.js';
import { renderTranscript } from './history.js';
import type { HistoryTurn, Language, Usage } from './types.js';

export const answerSchema = z.object({
  reply: z.string(),
  cited_article_ids: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type Answer = z.infer<typeof answerSchema>;

export const ANSWER_TOOL = {
  name: 'compose_answer',
  description:
    'Return the chat reply for the customer, the ids of the articles it relies on, and confidence.',
  inputSchema: z.toJSONSchema(answerSchema) as Record<string, unknown>,
};

export type ResponderResult =
  | { ok: true; rawAnswer: unknown; promptVersion: string; usage: Usage; attempts: number }
  | { ok: false; promptVersion: string; attempts: number; error: string };

export interface ResponderDeps {
  provider: LlmProvider;
  prompts: PromptRegistry;
  promptVersion: string;
  retry: RetryOptions;
  maxOutputTokens: number;
}

const LANGUAGE_NAMES: Record<Language, string> = { id: 'Indonesian', en: 'English' };

export class Responder {
  constructor(private readonly deps: ResponderDeps) {}

  /** Returns the unvalidated tool input; OutputValidator decides whether it may be sent. */
  async respond(
    text: string,
    history: HistoryTurn[],
    language: Language,
    articles: RetrievedArticle[],
  ): Promise<ResponderResult> {
    const prompt = this.deps.prompts.get(this.deps.promptVersion);
    const system = renderPrompt(prompt.template, {
      language: LANGUAGE_NAMES[language],
      articles: articles
        .map(({ article }) => formatArticle(article.id, article.title, article.body))
        .join('\n\n'),
    });
    try {
      const { value, attempts } = await withRetry(
        (signal) =>
          this.deps.provider.callTool({
            system,
            messages: [{ role: 'user', content: renderTranscript(history, text) }],
            tool: ANSWER_TOOL,
            maxOutputTokens: this.deps.maxOutputTokens,
            signal,
          }),
        this.deps.retry,
      );
      return {
        ok: true,
        rawAnswer: value.input,
        promptVersion: prompt.version,
        usage: value.usage,
        attempts,
      };
    } catch (error) {
      if (error instanceof RetryExhaustedError) {
        return {
          ok: false,
          promptVersion: prompt.version,
          attempts: error.attempts,
          error: error.lastError.kind,
        };
      }
      throw error;
    }
  }
}

function formatArticle(id: string, title: string, body: string): string {
  return `<article id="${id}">\n# ${title}\n${body}\n</article>`;
}
