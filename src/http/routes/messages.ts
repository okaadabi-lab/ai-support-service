import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import type { IncomingMessage } from '../../pipeline/message-pipeline.js';
import { rateLimitBy } from '../rate-limits.js';
import { incomingMessageSchema } from '../schemas.js';
import { parseOrThrow } from '../validation.js';

export function registerMessageRoutes(app: FastifyInstance, container: Container): void {
  const perCustomer = rateLimitBy(
    app,
    'customer',
    container.config.rateLimit.perCustomerPerMinute,
    (request) => {
      const body = request.body as IncomingMessage;
      return `${body.channel}:${body.customer_id}`;
    },
  );

  app.post(
    '/v1/messages',
    {
      config: { scope: 'messages:write' },
      // Validate before rate limiting so the per-customer key comes from a well-formed body.
      preValidation: async (request) => {
        request.body = parseOrThrow(incomingMessageSchema, request.body);
      },
      preHandler: perCustomer,
    },
    async (request, reply) => {
      const outcome = await container.pipeline.handle(request.body as IncomingMessage, request.log);
      void reply.header('idempotent-replayed', String(outcome.replayed));
      return reply.code(outcome.replayed ? 200 : 201).send(outcome.response);
    },
  );
}
