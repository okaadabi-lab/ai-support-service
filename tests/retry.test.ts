import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../src/llm/provider.js';
import { backoffDelay, RetryExhaustedError, withRetry } from '../src/llm/retry.js';

const options = (overrides = {}) => ({
  maxAttempts: 3,
  timeoutMs: 50,
  baseDelayMs: 100,
  maxDelayMs: 1000,
  sleep: vi.fn(() => Promise.resolve()),
  random: () => 0.5,
  ...overrides,
});

describe('backoffDelay', () => {
  it('grows exponentially, is capped, and is scaled by jitter', () => {
    expect(backoffDelay(1, 100, 1000, () => 0.999)).toBe(99);
    expect(backoffDelay(3, 100, 1000, () => 0.5)).toBe(200);
    expect(backoffDelay(10, 100, 1000, () => 0.5)).toBe(500);
    expect(backoffDelay(2, 100, 1000, () => 0)).toBe(0);
  });
});

describe('withRetry', () => {
  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    const opts = options();
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(LlmError.fromStatus(429, 'rate limited'))
      .mockRejectedValueOnce(LlmError.fromStatus(529, 'overloaded'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(operation, opts)).resolves.toEqual({ value: 'ok', attempts: 3 });
    expect(opts.sleep.mock.calls).toEqual([[50], [100]]);
  });

  it('does not retry client errors', async () => {
    const operation = vi.fn(() => Promise.reject(LlmError.fromStatus(400, 'bad request')));
    const error = await withRetry(operation, options()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect(error).toMatchObject({ attempts: 1, lastError: { kind: 'client_error' } });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging call after the timeout and retries it', async () => {
    const signals: AbortSignal[] = [];
    const operation = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          signals.push(signal);
          if (signals.length === 2) {
            resolve('second try');
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    await expect(withRetry(operation, options({ timeoutMs: 20 }))).resolves.toEqual({
      value: 'second try',
      attempts: 2,
    });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('times out a call that ignores the abort signal', async () => {
    const operation = vi.fn(() => new Promise<string>(() => {}));
    const error = await withRetry(operation, options({ maxAttempts: 2, timeoutMs: 20 })).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ attempts: 2, lastError: { kind: 'timeout' } });
  });

  it('gives up after maxAttempts and reports the last error', async () => {
    const operation = vi.fn(() => Promise.reject(LlmError.fromStatus(503, 'unavailable')));
    const error = await withRetry(operation, options({ maxAttempts: 2 })).catch((e: unknown) => e);
    expect(error).toMatchObject({ attempts: 2, lastError: { kind: 'server_error', status: 503 } });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
