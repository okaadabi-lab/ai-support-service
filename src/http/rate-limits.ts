import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { RateLimitedError } from '../errors.js';

type Limiter = ReturnType<FastifyInstance['createRateLimit']>;

const ONE_MINUTE_MS = 60_000;

/**
 * Builds a preHandler that enforces a fixed-window limit keyed by `keyOf(request)`.
 * Counters live in the @fastify/rate-limit in-memory store, so they are per process:
 * running several instances needs a shared store (the plugin supports Redis).
 */
export function rateLimitBy(
  app: FastifyInstance,
  scope: 'api_key' | 'customer',
  maxPerMinute: number,
  keyOf: (request: FastifyRequest) => string,
): preHandlerAsyncHookHandler {
  const limiter: Limiter = app.createRateLimit({
    max: maxPerMinute,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (request) => `${scope}:${keyOf(request)}`,
  });

  return async (request, reply) => {
    const result = await limiter(request);
    if (result.isAllowed) {
      return;
    }
    void reply.header(`x-ratelimit-${scope.replace('_', '-')}-remaining`, result.remaining);
    if (result.isExceeded) {
      void reply.header('retry-after', result.ttlInSeconds);
      throw new RateLimitedError(result.ttlInSeconds, scope);
    }
  };
}
