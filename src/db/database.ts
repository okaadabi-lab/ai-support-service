import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { schemaSql, schemaVersion } from './schema.js';

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= schemaVersion) {
    return;
  }
  db.transaction(() => {
    db.exec(schemaSql);
    db.pragma(`user_version = ${schemaVersion}`);
  })();
}
