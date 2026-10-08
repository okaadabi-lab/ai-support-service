import { classifyByKeywords } from '../pipeline/keyword-classifier.js';
import { tokenize } from '../retrieval/tokenizer.js';
import { estimateTokens } from '../pipeline/history.js';
import {
  LlmError,
  type LlmProvider,
  type ToolCallRequest,
  type ToolCallResult,
} from './provider.js';

export type FakeStep =
  | { input: unknown }
  | { error: LlmError }
  | { hang: true }
  | ((request: ToolCallRequest) => unknown);

/**
 * Deterministic provider with no network access. Tests enqueue scripted steps per tool;
 * when a tool has no scripted step left, the built-in demo behaviour answers instead, which
 * is what `LLM_PROVIDER=fake` uses for local runs.
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly calls: ToolCallRequest[] = [];
  private readonly scripts = new Map<string, FakeStep[]>();

  constructor(readonly model = 'fake-model') {}

  enqueue(toolName: string, ...steps: FakeStep[]): this {
    this.scripts.set(toolName, [...(this.scripts.get(toolName) ?? []), ...steps]);
    return this;
  }

  callsFor(toolName: string): ToolCallRequest[] {
    return this.calls.filter((call) => call.tool.name === toolName);
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    this.calls.push(request);
    const step = this.scripts.get(request.tool.name)?.shift();
    const input = await this.run(step, request);
    return { input, usage: estimateUsage(request, input) };
  }

  private async run(step: FakeStep | undefined, request: ToolCallRequest): Promise<unknown> {
    if (step === undefined) {
      return demoResponse(request);
    }
    if (typeof step === 'function') {
      return step(request);
    }
    if ('error' in step) {
      throw step.error;
    }
    if ('hang' in step) {
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    }
    return step.input;
  }
}

function estimateUsage(request: ToolCallRequest, output: unknown): ToolCallResult['usage'] {
  const prompt = request.system + request.messages.map((message) => message.content).join('\n');
  return {
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(JSON.stringify(output ?? null)),
  };
}

function demoResponse(request: ToolCallRequest): unknown {
  const latest = latestCustomerMessage(request);
  switch (request.tool.name) {
    case 'classify_message': {
      const result = classifyByKeywords(latest);
      return { ...result, confidence: result.intent === 'other' ? 0.7 : 0.9 };
    }
    case 'compose_answer':
      return demoAnswer(request.system, latest);
    default:
      throw new LlmError(
        'client_error',
        `FakeProvider has no demo response for ${request.tool.name}`,
      );
  }
}

function latestCustomerMessage(request: ToolCallRequest): string {
  const content = request.messages.at(-1)?.content ?? '';
  const match = /<latest_customer_message>\n([\s\S]*?)\n<\/latest_customer_message>/.exec(content);
  return match?.[1] ?? content;
}

/** Quotes the line of the top-ranked article that shares the most words with the question. */
function demoAnswer(system: string, question: string): unknown {
  const article = /<article id="([^"]+)">\n# [^\n]*\n([\s\S]*?)\n<\/article>/.exec(system);
  if (!article?.[1] || article[2] === undefined) {
    return { reply: 'Admin kami akan bantu ya kak.', cited_article_ids: [], confidence: 0.2 };
  }
  const questionTerms = new Set(tokenize(question));
  const lines = article[2]
    .split('\n')
    .map((line) => line.replace(/^(\s*[-*]|\s*\d+\.)\s+/, '').trim())
    .filter((line) => line.length > 0);
  let best = lines[0] ?? '';
  let bestOverlap = 0;
  for (const line of lines) {
    const overlap = new Set(tokenize(line).filter((term) => questionTerms.has(term))).size;
    if (overlap > bestOverlap) {
      best = line;
      bestOverlap = overlap;
    }
  }
  const english = system.includes("customer's language: English");
  return {
    reply: english ? `From our info: ${best}` : `Halo kak, info dari kami: ${best}`,
    cited_article_ids: [article[1]],
    confidence: bestOverlap > 0 ? 0.85 : 0.4,
  };
}
