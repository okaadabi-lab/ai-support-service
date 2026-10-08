import { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, type MessagesClient } from '../src/llm/anthropic-provider.js';
import { LlmError, type ToolCallRequest } from '../src/llm/provider.js';
import { CLASSIFY_TOOL } from '../src/pipeline/classifier.js';

const request = (): ToolCallRequest => ({
  system: 'system prompt',
  messages: [{ role: 'user', content: 'halo' }],
  tool: CLASSIFY_TOOL,
  maxOutputTokens: 256,
  signal: new AbortController().signal,
});

function providerReturning(create: ReturnType<typeof vi.fn>) {
  const client = { messages: { create } } as unknown as MessagesClient;
  return new AnthropicProvider('unused', 'claude-haiku-5-5', client);
}

describe('AnthropicProvider', () => {
  it('forces the tool and returns its input with token usage', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'classify_message', input: { intent: 'greeting' } }],
      usage: { input_tokens: 120, output_tokens: 15 },
    });
    const result = await providerReturning(create).callTool(request());

    expect(result).toEqual({
      input: { intent: 'greeting' },
      usage: { inputTokens: 120, outputTokens: 15 },
    });
    const [params, options] = create.mock.calls[0] as [
      Record<string, unknown>,
      { signal: AbortSignal },
    ];
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 256,
      tool_choice: { type: 'tool', name: 'classify_message' },
      tools: [{ name: 'classify_message', input_schema: { type: 'object' } }],
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a response without the forced tool call as no_tool_call', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(providerReturning(create).callTool(request())).rejects.toMatchObject({
      kind: 'no_tool_call',
    });
  });

  it.each([
    [429, 'rate_limited', true],
    [500, 'server_error', true],
    [529, 'server_error', true],
    [400, 'client_error', false],
    [401, 'client_error', false],
  ])('maps HTTP %i to %s (retryable: %s)', async (status, kind, retryable) => {
    const create = vi
      .fn()
      .mockRejectedValue(APIError.generate(status, {}, 'failure', new Headers()));
    const error = await providerReturning(create)
      .callTool(request())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ kind, retryable });
  });

  it('maps SDK connection timeouts to a retryable timeout', async () => {
    const create = vi.fn().mockRejectedValue(new APIConnectionTimeoutError());
    await expect(providerReturning(create).callTool(request())).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });
});
