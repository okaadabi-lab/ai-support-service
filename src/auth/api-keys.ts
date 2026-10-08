import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiKeyRecord, ApiKeyRepository, Scope } from '../repositories/api-key-repository.js';

// Format: sup_<8 hex prefix>_<43 char base64url secret>. The prefix is a non-secret lookup id
// that is safe to log; the full key is only ever stored as a SHA-256 hash.
const KEY_PATTERN = /^sup_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `sup_${prefix}_${secret}`;
  return { plaintext, prefix, hash: hashApiKey(plaintext) };
}

/**
 * Keys carry 256 bits of randomness, so a fast unsalted hash is sufficient: there is nothing
 * to brute-force that a slow password hash would protect.
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function parseBearer(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

export class ApiKeyAuthenticator {
  constructor(private readonly keys: ApiKeyRepository) {}

  authenticate(plaintext: string): ApiKeyRecord | undefined {
    const match = KEY_PATTERN.exec(plaintext);
    if (!match?.[1]) {
      return undefined;
    }
    const record = this.keys.findActiveByPrefix(match[1]);
    if (!record) {
      return undefined;
    }
    const presented = Buffer.from(hashApiKey(plaintext), 'hex');
    const stored = Buffer.from(record.keyHash, 'hex');
    return presented.length === stored.length && timingSafeEqual(presented, stored)
      ? record
      : undefined;
  }
}

export function hasScope(record: ApiKeyRecord, scope: Scope): boolean {
  return record.scopes.includes(scope);
}
