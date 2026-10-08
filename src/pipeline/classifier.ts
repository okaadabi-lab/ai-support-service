import { z } from 'zod';
import type { LlmProvider } from '../llm/provider.js';
import { type PromptRegistry, renderPrompt } from '../llm/prompts.js';
import { RetryExhaustedError, type RetryOptions, withRetry } from '../llm/retry.js';
import { renderTranscript } from './history.js';
import { classifyByKeywords } from './keyword-classifier.js';
import {
  type ClassifierSource,
  type HistoryTurn,
  INTENTS,
  type Intent,
  LANGUAGES,
  type Language,
  type Usage,
  ZERO_USAGE,
} from './types.js';

export const classificationSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  language: z.enum(LANGUAGES),
});

export const CLASSIFY_TOOL = {
  name: 'classify_message',
  description: 'Record the intent, language and confidence for the latest customer message.',
  inputSchema: z.toJSONSchema(classificationSchema) as Record<string, unknown>,
};

export interface Classification {
  intent: Intent;
  confidence: number;
  language: Language;
  source: ClassifierSource;
  promptVersion: string;
  usage: Usage;
  attempts: number;
  error?: string;
}

export interface ClassifierDeps {
  provider: LlmProvider;
  prompts: PromptRegistry;
  promptVersion: string;
  retry: RetryOptions;
  maxOutputTokens: number;
}

export class IntentClassifier {
  constructor(private readonly deps: ClassifierDeps) {}

  async classify(text: string, history: HistoryTurn[]): Promise<Classification> {
    const prompt = this.deps.prompts.get(this.deps.promptVersion);
    try {
      const { value, attempts } = await withRetry(
        (signal) =>
          this.deps.provider.callTool({
            system: renderPrompt(prompt.template, {}),
            messages: [{ role: 'user', content: renderTranscript(history, text) }],
            tool: CLASSIFY_TOOL,
            maxOutputTokens: this.deps.maxOutputTokens,
            signal,
          }),
        this.deps.retry,
      );
      const parsed = classificationSchema.safeParse(value.input);
      if (!parsed.success) {
        return this.fallback(text, prompt.version, value.usage, attempts, 'invalid_tool_input');
      }
      return {
        ...parsed.data,
        source: 'llm',
        promptVersion: prompt.version,
        usage: value.usage,
        attempts,
      };
    } catch (error) {
      if (error instanceof RetryExhaustedError) {
        return this.fallback(
          text,
          prompt.version,
          ZERO_USAGE,
          error.attempts,
          error.lastError.kind,
        );
      }
      throw error;
    }
  }

  private fallback(
    text: string,
    promptVersion: string,
    usage: Usage,
    attempts: number,
    error: string,
  ): Classification {
    return {
      ...classifyByKeywords(text),
      source: 'fallback',
      promptVersion,
      usage,
      attempts,
      error,
    };
  }
}
