import { z } from 'zod';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** JSON Schema for a tool's input, without the `$schema` dialect marker zod adds. */
export function toolInputSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

export interface ToolCallRequest {
  system: string;
  messages: ChatTurn[];
  tool: ToolDefinition;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCallResult {
  input: unknown;
  usage: TokenUsage;
}

/**
 * A provider must force the model to call `tool` and return the raw tool input.
 * Validation of that input is the caller's job; providers never trust it.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  callTool(request: ToolCallRequest): Promise<ToolCallResult>;
}

export type LlmErrorKind =
  | 'timeout'
  | 'connection_error'
  | 'rate_limited'
  | 'server_error'
  | 'client_error'
  | 'no_tool_call';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  get retryable(): boolean {
    return (
      this.kind === 'timeout' ||
      this.kind === 'connection_error' ||
      this.kind === 'rate_limited' ||
      this.kind === 'server_error'
    );
  }

  static fromStatus(status: number, message: string): LlmError {
    if (status === 429) {
      return new LlmError('rate_limited', message, status);
    }
    if (status >= 500) {
      return new LlmError('server_error', message, status);
    }
    return new LlmError('client_error', message, status);
  }
}
