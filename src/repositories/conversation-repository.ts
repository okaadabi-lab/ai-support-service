import { randomUUID } from 'node:crypto';
import type { Db } from '../db/database.js';

export type ConversationStatus = 'bot' | 'human';

export interface Conversation {
  id: string;
  channel: string;
  customerId: string;
  customerName: string | null;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

interface ConversationRow {
  id: string;
  channel: string;
  customer_id: string;
  customer_name: string | null;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, channel, customer_id, customer_name, status, created_at, updated_at';

export class ConversationRepository {
  constructor(private readonly db: Db) {}

  /** One conversation per (channel, customer); the name is refreshed when the channel sends one. */
  upsert(channel: string, customerId: string, customerName: string | null): Conversation {
    const row = this.db
      .prepare(
        `INSERT INTO conversations (id, channel, customer_id, customer_name)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (channel, customer_id) DO UPDATE SET
           customer_name = COALESCE(excluded.customer_name, conversations.customer_name)
         RETURNING ${COLUMNS}`,
      )
      .get(randomUUID(), channel, customerId, customerName) as ConversationRow;
    return toConversation(row);
  }

  findById(id: string): Conversation | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM conversations WHERE id = ?`).get(id) as
      ConversationRow | undefined;
    return row ? toConversation(row) : undefined;
  }

  setStatus(id: string, status: ConversationStatus): Conversation | undefined {
    const row = this.db
      .prepare(
        `UPDATE conversations
         SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?
         RETURNING ${COLUMNS}`,
      )
      .get(status, id) as ConversationRow | undefined;
    return row ? toConversation(row) : undefined;
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    channel: row.channel,
    customerId: row.customer_id,
    customerName: row.customer_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
