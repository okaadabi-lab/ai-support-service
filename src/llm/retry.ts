import { LlmError } from './provider.js';

export interface RetryOptions {
  maxAttempts: number;
  timeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

export class RetryExhaustedError extends Error {
  constructor(
    readonly lastError: LlmError,
    readonly attempts: number,
  ) {
    super(`LLM call failed after ${attempts} attempt(s): ${lastError.message}`);
    this.name = 'RetryExhaustedError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Full-jitter exponential backoff: delay is uniform in [0, min(max, base * 2^(n-1))].
 * Spreading retries randomly avoids many clients hammering the API in lockstep after a 429.
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

export async function withRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions,
): Promise<RetryResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      const value = await runWithTimeout(operation, options.timeoutMs);
      return { value, attempts: attempt };
    } catch (error) {
      const llmError = toLlmError(error);
      if (!llmError.retryable || attempt >= options.maxAttempts) {
        throw new RetryExhaustedError(llmError, attempt);
      }
      await sleep(backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs, random));
    }
  }
}

async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmError('timeout', `LLM call timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmError('client_error', message);
}
