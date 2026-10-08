import type { Db } from '../db/database.js';
import type { HistoryTurn } from '../pipeline/types.js';

export interface MessageRecord {
  id: number;
  role: 'customer' | 'assistant';
  text: string;
  externalMessageId: string | null;
  receivedAt: string | null;
  createdAt: string;
}

interface MessageRow {
  id: number;
  role: 'customer' | 'assistant';
  text: string;
  external_message_id: string | null;
  received_at: string | null;
  created_at: string;
}

export interface NewCustomerMessage {
  conversationId: string;
  channel: string;
  externalMessageId: string;
  text: string;
  receivedAt: string;
}

export class MessageRepository {
  constructor(private readonly db: Db) {}

  insertCustomerMessage(message: NewCustomerMessage): number {
    const result = this.db
      .prepare(
        `INSERT INTO messages (conversation_id, role, text, channel, external_message_id, received_at)
         VALUES (?, 'customer', ?, ?, ?, ?)`,
      )
      .run(
        message.conversationId,
        message.text,
        message.channel,
        message.externalMessageId,
        message.receivedAt,
      );
    return Number(result.lastInsertRowid);
  }

  insertAssistantMessage(conversationId: string, channel: string, text: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO messages (conversation_id, role, text, channel) VALUES (?, 'assistant', ?, ?)`,
      )
      .run(conversationId, text, channel);
    return Number(result.lastInsertRowid);
  }

  findIdByExternalId(channel: string, externalMessageId: string): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM messages WHERE channel = ? AND external_message_id = ?')
      .get(channel, externalMessageId) as { id: number } | undefined;
    return row?.id;
  }

  /** Most recent turns first-to-last; the caller trims them to a token budget. */
  recentTurns(conversationId: string, limit: number): HistoryTurn[] {
    const rows = this.db
      .prepare(`SELECT role, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`)
      .all(conversationId, limit) as HistoryTurn[];
    return rows.reverse();
  }

  listByConversation(conversationId: string): MessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, role, text, external_message_id, received_at, created_at
         FROM messages WHERE conversation_id = ? ORDER BY id`,
      )
      .all(conversationId) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      externalMessageId: row.external_message_id,
      receivedAt: row.received_at,
      createdAt: row.created_at,
    }));
  }
}
