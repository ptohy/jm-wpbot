import type PgBoss from 'pg-boss';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { enqueueOutbound } from '../messaging/outbox.js';
import { isWithinCustomerCareWindow, reminderFreeText, reminderTemplate, whatsappTemplatePayload, type ReminderKind } from '../messaging/reminders.js';

export async function enqueueDueReminders(db: Kysely<Database>, now = new Date()): Promise<number> {
  const rows = await db.selectFrom('appointments as a').innerJoin('services as s', 's.id', 'a.service_id').innerJoin('conversations as c', 'c.id', 'a.conversation_id')
    .select(['a.id', 'a.customer_id', 'a.conversation_id', 'a.scheduled_start_at', 'a.scheduled_local_date', 'a.scheduled_local_start_time', 's.name', 'c.last_inbound_at'])
    .where('a.status', '=', 'confirmed').where('a.scheduled_start_at', '>', now as any)
    .where('a.scheduled_start_at', '<=', new Date(now.getTime() + 86400000) as any).execute();
  let count = 0;
  for (const row of rows) for (const kind of ['24h', '3h'] as ReminderKind[]) {
    const due = new Date(new Date(row.scheduled_start_at).getTime() - (kind === '24h' ? 86400000 : 10800000));
    if (due > now) continue;
    const appointment = { id: row.id, date: row.scheduled_local_date, time: String(row.scheduled_local_start_time).slice(0, 5), service: row.name };
    const payload = isWithinCustomerCareWindow(row.last_inbound_at ? new Date(row.last_inbound_at) : null, now)
      ? { type: 'text', text: { body: reminderFreeText(kind, appointment) } }
      : whatsappTemplatePayload(reminderTemplate(kind, appointment));
    const id = await enqueueOutbound(db, { customerId: row.customer_id, conversationId: row.conversation_id ?? undefined, appointmentId: row.id, reminderKind: kind, payload, deliveryDueAt: now });
    if (id) count++;
  }
  return count;
}

export async function scheduleReminderSweep(boss: PgBoss): Promise<void> { await boss.createQueue('reminders.sweep'); await boss.send('reminders.sweep', {}, { singletonKey: 'reminders-sweep', startAfter: 60 }); }
