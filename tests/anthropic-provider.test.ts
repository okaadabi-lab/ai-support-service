import Anthropic, { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
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

  describe('with the real SDK client and a stubbed fetch', () => {
    function providerWithFetch(fetch: (url: unknown, init?: RequestInit) => Promise<Response>) {
      const client = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch });
      return new AnthropicProvider('test-key', 'claude-haiku-5-5', client);
    }

    it('sends a forced tool call that the SDK serialises as expected', async () => {
      const bodies: unknown[] = [];
      const provider = providerWithFetch((_url, init) => {
        bodies.push(JSON.parse(init?.body as string));
        return Promise.resolve(
          Response.json({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-5-5',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'classify_message',
                input: { intent: 'greeting', confidence: 0.9, language: 'id' },
              },
            ],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 42, output_tokens: 7 },
          }),
        );
      });

      const result = await provider.callTool(request());

      expect(result).toEqual({
        input: { intent: 'greeting', confidence: 0.9, language: 'id' },
        usage: { inputTokens: 42, outputTokens: 7 },
      });
      expect(bodies[0]).toMatchObject({
        model: 'claude-haiku-5-5',
        system: 'system prompt',
        messages: [{ role: 'user', content: 'halo' }],
        tool_choice: { type: 'tool', name: 'classify_message' },
        tools: [
          {
            name: 'classify_message',
            input_schema: { type: 'object', required: ['intent', 'confidence', 'language'] },
          },
        ],
      });
    });

    it('maps a network failure to a retryable connection error', async () => {
      const provider = providerWithFetch(() => Promise.reject(new TypeError('fetch failed')));
      await expect(provider.callTool(request())).rejects.toMatchObject({
        kind: 'connection_error',
        retryable: true,
      });
    });

    it('maps an overloaded 529 response to a retryable server error', async () => {
      const provider = providerWithFetch(() =>
        Promise.resolve(
          Response.json(
            { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
            { status: 529 },
          ),
        ),
      );
      await expect(provider.callTool(request())).rejects.toMatchObject({
        kind: 'server_error',
        status: 529,
        retryable: true,
      });
    });
  });
});
