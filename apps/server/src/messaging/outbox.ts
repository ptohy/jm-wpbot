import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  JsonObject,
  OutboxStatus,
  ReminderKind,
} from '../db/types.js';

type Db = Kysely<Database> | Transaction<Database>;

export async function enqueueOutbound(
  db: Db,
  input: {
    customerId: string;
    conversationId?: string;
    appointmentId?: string;
    reminderKind?: ReminderKind;
    hubIntentId?: string;
    payload: JsonObject;
    deliveryDueAt?: Date;
    reminderDueAt?: Date;
  },
) {
  const insert = db
    .insertInto('outbox_messages')
    .values({
      customer_id: input.customerId,
      conversation_id: input.conversationId ?? null,
      appointment_id: input.appointmentId ?? null,
      reminder_kind: input.reminderKind ?? null,
      hub_intent_id: input.hubIntentId ?? null,
      payload: input.payload,
      delivery_due_at: (input.deliveryDueAt ?? new Date()) as any,
      reminder_due_at: (input.reminderDueAt ?? null) as any,
    });

  const query = input.hubIntentId
    ? insert.onConflict((oc) =>
        oc
          .column('hub_intent_id')
          .where('hub_intent_id', 'is not', null)
          .doNothing(),
      )
    : insert.onConflict((oc) =>
        oc
          .columns(['appointment_id', 'reminder_kind'])
          .where('appointment_id', 'is not', null)
          .where('reminder_kind', 'is not', null)
          .doNothing(),
      );

  const row = await query.returning('id').executeTakeFirst();
  return row?.id;
}

export async function claimOutbound(db: Db, limit = 20) {
  return db.transaction().execute(async (tx) => {
    const rows = await tx
      .selectFrom('outbox_messages')
      .selectAll()
      .where('status', 'in', ['pending', 'retrying'] as OutboxStatus[])
      .where('delivery_due_at', '<=', new Date())
      .orderBy('delivery_due_at')
      .orderBy('id')
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();

    if (rows.length) {
      await tx
        .updateTable('outbox_messages')
        .set({
          status: 'retrying',
          attempts: (eb) => eb('attempts', '+', 1),
          updated_at: new Date() as any,
        })
        .where(
          'id',
          'in',
          rows.map((row) => row.id),
        )
        .execute();
    }
    return rows;
  });
}

export async function markDelivered(
  db: Db,
  id: string,
  providerMessageId: string,
) {
  await db
    .updateTable('outbox_messages')
    .set({
      status: 'delivered',
      provider_message_id: providerMessageId,
      delivered_at: new Date() as any,
      updated_at: new Date() as any,
    })
    .where('id', '=', id)
    .execute();
}

export async function markDeliveredByProviderMessageId(
  db: Db,
  providerMessageId: string,
) {
  return db
    .updateTable('outbox_messages')
    .set({
      status: 'delivered',
      delivered_at: new Date() as any,
      updated_at: new Date() as any,
    })
    .where('provider_message_id', '=', providerMessageId)
    .where('status', '!=', 'delivered')
    .returning(['id', 'hub_intent_id'])
    .executeTakeFirst();
}

export async function markFailedByProviderMessageId(
  db: Db,
  providerMessageId: string,
  error: string,
) {
  return db
    .updateTable('outbox_messages')
    .set({
      status: 'failed',
      last_error: error.slice(0, 500),
      updated_at: new Date() as any,
    })
    .where('provider_message_id', '=', providerMessageId)
    .where('status', '!=', 'failed')
    .returning(['id', 'hub_intent_id'])
    .executeTakeFirst();
}

export async function markSent(
  db: Db,
  id: string,
  providerMessageId: string,
) {
  await db
    .updateTable('outbox_messages')
    .set({
      status: 'sent',
      provider_message_id: providerMessageId,
      updated_at: new Date() as any,
    })
    .where('id', '=', id)
    .execute();
}

export async function markFailed(
  db: Db,
  id: string,
  error: string,
  nextAttemptAt: Date,
  terminal = false,
) {
  await db
    .updateTable('outbox_messages')
    .set({
      status: terminal ? 'failed' : 'retrying',
      last_error: error,
      delivery_due_at: nextAttemptAt as any,
      updated_at: new Date() as any,
    })
    .where('id', '=', id)
    .execute();
}

export async function findHubDeliveryReportCandidate(
  db: Db,
  hubIntentId: string,
) {
  return db
    .selectFrom('outbox_messages')
    .select([
      'id',
      'status',
      'provider_message_id',
      'hub_intent_id',
      'hub_delivery_reported_at',
    ])
    .where('hub_intent_id', '=', hubIntentId)
    .executeTakeFirst();
}

export async function markHubDeliveryReported(
  db: Db,
  outboxId: string,
) {
  await db
    .updateTable('outbox_messages')
    .set({
      hub_delivery_reported_at: new Date() as any,
      hub_delivery_error: null,
      updated_at: new Date() as any,
    })
    .where('id', '=', outboxId)
    .execute();
}

export async function markHubDeliveryReportError(
  db: Db,
  outboxId: string,
  error: string,
) {
  await db
    .updateTable('outbox_messages')
    .set({
      hub_delivery_error: error.slice(0, 500),
      updated_at: new Date() as any,
    })
    .where('id', '=', outboxId)
    .execute();
}
