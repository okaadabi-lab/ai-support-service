import Anthropic, { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import {
  LlmError,
  type LlmProvider,
  type ToolCallRequest,
  type ToolCallResult,
} from './provider.js';

/** The one SDK method this provider uses; narrowed so tests can pass a stub. */
export interface MessagesClient {
  messages: Pick<Anthropic['messages'], 'create'>;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: MessagesClient;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: MessagesClient,
  ) {
    // Retries and timeouts are owned by withRetry so that every attempt is visible and bounded.
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 0 });
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: request.messages,
          tools: [
            {
              name: request.tool.name,
              description: request.tool.description,
              input_schema: { type: 'object', ...request.tool.inputSchema },
            },
          ],
          tool_choice: { type: 'tool', name: request.tool.name },
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw mapError(error);
    }

    const toolUse = response.content.find(
      (block) => block.type === 'tool_use' && block.name === request.tool.name,
    );
    if (toolUse?.type !== 'tool_use') {
      throw new LlmError('no_tool_call', `Model did not call ${request.tool.name}`);
    }
    return {
      input: toolUse.input,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

function mapError(error: unknown): unknown {
  if (error instanceof APIConnectionTimeoutError) {
    return new LlmError('timeout', error.message);
  }
  if (error instanceof APIError && typeof error.status === 'number') {
    return LlmError.fromStatus(error.status, error.message);
  }
  // Aborts from our own timeout are recognised by withRetry via the signal.
  return error;
}
