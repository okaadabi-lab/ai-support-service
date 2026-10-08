import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hasScope, parseBearer, type ApiKeyAuthenticator } from '../auth/api-keys.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import type { ApiKeyRecord, Scope } from '../repositories/api-key-repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey: ApiKeyRecord | null;
  }
  interface FastifyContextConfig {
    scope?: Scope;
  }
}

/**
 * Registers an onRequest hook on the current encapsulation scope. Every route in that scope
 * must declare `config.scope`; a route without one is rejected at startup rather than left open.
 */
export function registerApiKeyAuth(app: FastifyInstance, authenticator: ApiKeyAuthenticator): void {
  app.decorateRequest('apiKey', null);

  app.addHook('onRoute', (route) => {
    if (!route.config?.scope) {
      throw new Error(`Route ${route.method.toString()} ${route.url} must declare config.scope`);
    }
  });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const plaintext = parseBearer(request.headers.authorization);
    const record = plaintext ? authenticator.authenticate(plaintext) : undefined;
    if (!record) {
      throw new UnauthorizedError();
    }
    const scope = request.routeOptions.config.scope;
    if (!scope || !hasScope(record, scope)) {
      throw new ForbiddenError(scope ?? 'unknown');
    }
    request.apiKey = record;
    request.log = request.log.child({ apiKeyPrefix: record.keyPrefix });
  });
}
