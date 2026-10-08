import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { metricsQuerySchema } from '../schemas.js';
import { parseOrThrow } from '../validation.js';

export function registerMetricsRoutes(app: FastifyInstance, container: Container): void {
  app.get('/v1/metrics', { config: { scope: 'admin:read' } }, async (request) => {
    const window = parseOrThrow(metricsQuerySchema, request.query);
    return container.metrics.aggregate(window);
  });
}
