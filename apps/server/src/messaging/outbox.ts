import type { Kysely, Transaction } from 'kysely';
import type { Database, JsonObject, OutboxStatus, ReminderKind } from '../db/types.js';

type Db = Kysely<Database> | Transaction<Database>;
export async function enqueueOutbound(db: Db, input: { customerId: string; conversationId?: string; appointmentId?: string; reminderKind?: ReminderKind; payload: JsonObject; deliveryDueAt?: Date; reminderDueAt?: Date }) {
  const row = await db.insertInto('outbox_messages').values({ customer_id: input.customerId, conversation_id: input.conversationId ?? null, appointment_id: input.appointmentId ?? null, reminder_kind: input.reminderKind ?? null, payload: input.payload, delivery_due_at: (input.deliveryDueAt ?? new Date()) as any, reminder_due_at: (input.reminderDueAt ?? null) as any }).onConflict((oc) => oc.columns(['appointment_id', 'reminder_kind']).where('appointment_id', 'is not', null).where('reminder_kind', 'is not', null).doNothing()).returning('id').executeTakeFirst();
  return row?.id;
}
export async function claimOutbound(db: Db, limit = 20) {
  return db.transaction().execute(async (tx) => {
    const rows = await tx.selectFrom('outbox_messages').selectAll().where('status', 'in', ['pending', 'retrying'] as OutboxStatus[]).where('delivery_due_at', '<=', new Date()).orderBy('delivery_due_at').orderBy('id').limit(limit).forUpdate().skipLocked().execute();
    if (rows.length) await tx.updateTable('outbox_messages').set({ status: 'retrying', attempts: (eb) => eb('attempts', '+', 1), updated_at: new Date() as any }).where('id', 'in', rows.map((r) => r.id)).execute();
    return rows;
  });
}
export async function markDelivered(db: Db, id: string, providerMessageId: string) { await db.updateTable('outbox_messages').set({ status: 'delivered', provider_message_id: providerMessageId, delivered_at: new Date() as any, updated_at: new Date() as any }).where('id', '=', id).execute(); }
export async function markSent(db: Db, id: string, providerMessageId: string) { await db.updateTable('outbox_messages').set({ status: 'sent', provider_message_id: providerMessageId, updated_at: new Date() as any }).where('id', '=', id).execute(); }
export async function markFailed(db: Db, id: string, error: string, nextAttemptAt: Date, terminal = false) { await db.updateTable('outbox_messages').set({ status: terminal ? 'failed' : 'retrying', last_error: error, delivery_due_at: nextAttemptAt as any, updated_at: new Date() as any }).where('id', '=', id).execute(); }
