import PgBoss from 'pg-boss';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { debounceDueAt } from '../conversation/debounce.js';
import { sql } from 'kysely';

export type ConversationJob = { conversationId: string };
export async function createQueue(databaseUrl: string) { const boss = new PgBoss({ connectionString: databaseUrl }); await boss.start(); return boss; }
export async function enqueueConversation(boss: PgBoss, conversationId: string) {
  return boss.send('conversation.turn', { conversationId } satisfies ConversationJob, {
    startAfter: debounceDueAt(), singletonKey: conversationId, singletonSeconds: 5,
  });
}
export async function withConversationLock<T>(db: Kysely<Database>, conversationId: string, work: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => { await sql`select pg_advisory_xact_lock(hashtextextended(${conversationId}, 0))`.execute(tx); return work(tx); });
}
