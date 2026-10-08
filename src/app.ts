import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { type Container, type ContainerOverrides, createContainer } from './container.js';
import { AppError } from './errors.js';
import { registerApiKeyAuth } from './http/auth-plugin.js';
import { rateLimitBy } from './http/rate-limits.js';
import { registerConversationRoutes } from './http/routes/conversations.js';
import { registerMessageRoutes } from './http/routes/messages.js';
import { registerMetricsRoutes } from './http/routes/metrics.js';

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface BuildAppOptions extends ContainerOverrides {
  logger?: boolean;
}

export async function buildApp(
  config: AppConfig,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: ['req.headers.authorization', 'headers.authorization'],
              censor: '[redacted]',
            },
          },
    bodyLimit: 64 * 1024,
    // Reuse the caller's id (n8n can pass its execution id) so logs correlate across services.
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
    },
  });

  const container = createContainer(config, options);
  app.decorate('container', container);
  app.addHook('onClose', () => {
    container.db.close();
  });
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: 'bad_request', message: error.message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );

  await app.register(rateLimit, { global: false });

  app.get('/health', async (_request, reply) => {
    try {
      container.db.prepare('SELECT 1').get();
      return { status: 'ok', provider: container.provider.name, model: container.provider.model };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  await app.register(async (api) => {
    registerApiKeyAuth(api, container.authenticator);
    api.addHook(
      'onRequest',
      rateLimitBy(
        api,
        'api_key',
        config.rateLimit.perKeyPerMinute,
        (request) => request.apiKey?.keyPrefix ?? 'anonymous',
      ),
    );
    registerMessageRoutes(api, container);
    registerConversationRoutes(api, container);
    registerMetricsRoutes(api, container);
  });

  return app;
}
