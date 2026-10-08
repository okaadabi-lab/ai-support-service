import type { Db } from '../db/database.js';

export const SCOPES = ['messages:write', 'admin:read'] as const;

export type Scope = (typeof SCOPES)[number];

export interface ApiKeyRecord {
  id: number;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: Scope[];
}

interface ApiKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string;
}

export class ApiKeyRepository {
  constructor(private readonly db: Db) {}

  insert(name: string, keyPrefix: string, keyHash: string, scopes: Scope[]): number {
    const result = this.db
      .prepare('INSERT INTO api_keys (name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?)')
      .run(name, keyPrefix, keyHash, JSON.stringify(scopes));
    return Number(result.lastInsertRowid);
  }

  findActiveByPrefix(keyPrefix: string): ApiKeyRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT id, name, key_prefix, key_hash, scopes FROM api_keys WHERE key_prefix = ? AND revoked_at IS NULL',
      )
      .get(keyPrefix) as ApiKeyRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      keyHash: row.key_hash,
      scopes: JSON.parse(row.scopes) as Scope[],
    };
  }
}
