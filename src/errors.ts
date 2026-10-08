export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'not_found', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid API key') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(scope: string) {
    super(403, 'forbidden', `API key lacks the required scope: ${scope}`);
  }
}

export class RateLimitedError extends AppError {
  constructor(
    readonly retryAfterSeconds: number,
    scope: 'api_key' | 'customer',
  ) {
    super(429, 'rate_limited', `Rate limit exceeded for this ${scope.replace('_', ' ')}`);
  }
}
