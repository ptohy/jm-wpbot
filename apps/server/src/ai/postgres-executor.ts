import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { LunaAction, LunaToolExecutor } from './luna.js';
import { listAvailableSlots, toSaoPauloInstant, toSaoPauloWallClock } from '../domain/schedule.js';

function weekdayFor(date: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(toSaoPauloInstant(date, '12:00'));
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(name);
}

/** Executes model actions against PostgreSQL. Customer ownership is enforced
 * for every mutation; the model can never supply another customer's booking. */
export class PostgresLunaToolExecutor implements LunaToolExecutor {
  constructor(private readonly db: Kysely<Database> | Transaction<Database>) {}

  async execute(action: LunaAction, context?: { phone: string }): Promise<unknown> {
    if (!context?.phone) throw new Error('phone context is required');
    const customer = await this.db.selectFrom('customers').select(['id', 'whatsapp_phone'])
      .where('whatsapp_phone', '=', context.phone).executeTakeFirst();
    if (!customer) return { kind: 'error', code: 'customer_not_found' };
    if (action.action === 'list_services') return this.listServices();
    if (action.action === 'list_availability') return this.availability(action.serviceId, action.date);
    if (action.action === 'hold_slot') return this.hold(customer.id, action);
    if (action.action === 'confirm_hold') return this.confirm(customer.id, action.appointmentId);
    return this.cancel(customer.id, action.appointmentId);
  }

  private async availability(serviceId: string, date: string) {
    const service = await this.db.selectFrom('services').select(['id','name','default_duration_minutes','default_before_buffer_minutes','default_after_buffer_minutes']).where('id','=',serviceId).where('active','=',true).executeTakeFirst();
    if (!service) return { kind: 'error', code: 'service_not_found' };
    const professionals = await this.db.selectFrom('professionals').innerJoin('service_professionals','service_professionals.professional_id','professionals.id').select(['professionals.id','professionals.display_name','service_professionals.duration_minutes','service_professionals.before_buffer_minutes','service_professionals.after_buffer_minutes']).where('service_professionals.service_id','=',serviceId).where('professionals.active','=',true).where('service_professionals.active','=',true).execute();
    const day = weekdayFor(date);
    const from = toSaoPauloInstant(date, '00:00'), to = toSaoPauloInstant(date, '23:59');
    const slots: Array<{professionalId:string; professionalName:string; startTime:string; endTime:string}> = [];
    for (const professional of professionals) {
      const [hours, appointments, blocks] = await Promise.all([
        this.db.selectFrom('working_hours').select(['starts_at_local as startTime','ends_at_local as endTime']).where('professional_id','=',professional.id).where('weekday','=',day).where('active','=',true).execute(),
        this.db.selectFrom('appointments').select(['scheduled_start_at as startAt','scheduled_end_at as endAt','before_buffer_minutes as beforeBufferMinutes','after_buffer_minutes as afterBufferMinutes']).where('professional_id','=',professional.id).where('scheduled_start_at','<',to).where('scheduled_end_at','>',from).where(eb => eb.or([eb('status','=','confirmed'), eb.and([eb('status','=','hold'), eb('hold_expires_at','>',new Date())])])).execute(),
        this.db.selectFrom('schedule_blocks').select(['starts_at as startAt','ends_at as endAt']).where('professional_id','=',professional.id).where('starts_at','<',to).where('ends_at','>',from).execute(),
      ]);
      const result = listAvailableSlots({ date, workHours: hours.map(h => ({ startTime: String(h.startTime).slice(0,5), endTime: String(h.endTime).slice(0,5) })), durationMinutes: professional.duration_minutes ?? service.default_duration_minutes, beforeBufferMinutes: professional.before_buffer_minutes ?? service.default_before_buffer_minutes, afterBufferMinutes: professional.after_buffer_minutes ?? service.default_after_buffer_minutes, appointments: appointments.map(a => ({ startAt: new Date(a.startAt), endAt: new Date(a.endAt), beforeBufferMinutes: a.beforeBufferMinutes, afterBufferMinutes: a.afterBufferMinutes })), blocks: blocks.map(b => ({ startAt: new Date(b.startAt), endAt: new Date(b.endAt) })) });
      slots.push(...result.map(s => ({ professionalId: professional.id, professionalName: professional.display_name, startTime: s.localStartTime, endTime: s.localEndTime })));
    }
    return { kind: 'availability', serviceId, serviceName: service.name, date, slots };
  }

  private async listServices() {
    const services = await this.db.selectFrom('services').select(['id', 'name', 'description', 'base_price_cents as priceCents', 'default_duration_minutes as durationMinutes'])
      .where('active', '=', true).orderBy('name').execute();
    return { kind: 'services', services };
  }

  private async hold(customerId: string, action: Extract<LunaAction, { action: 'hold_slot' }>) {
    const service = await this.db.selectFrom('services').select(['id', 'name', 'base_price_cents', 'default_duration_minutes', 'default_before_buffer_minutes', 'default_after_buffer_minutes'])
      .where('id', '=', action.serviceId).where('active', '=', true).executeTakeFirst();
    const professional = await this.db.selectFrom('professionals').innerJoin('service_professionals','service_professionals.professional_id','professionals.id').select(['professionals.display_name','service_professionals.duration_minutes','service_professionals.before_buffer_minutes','service_professionals.after_buffer_minutes','service_professionals.service_id']).where('professionals.id','=',action.professionalId).where('service_professionals.service_id','=',action.serviceId).where('professionals.active', '=', true).where('service_professionals.active','=',true).executeTakeFirst();
    if (!service || !professional) return { kind: 'error', code: 'invalid_service_or_professional' };
    const start = new Date(action.startAt), end = new Date(action.endAt);
    const localStart = toSaoPauloWallClock(start), localEnd = toSaoPauloWallClock(end);
    if (localStart.date !== localEnd.date || start <= new Date() || end <= start) return { kind: 'error', code: 'invalid_slot' };
    const duration = professional.duration_minutes ?? service.default_duration_minutes;
    const before = professional.before_buffer_minutes ?? service.default_before_buffer_minutes;
    const after = professional.after_buffer_minutes ?? service.default_after_buffer_minutes;
    const availability = await this.availability(action.serviceId, localStart.date);
    const slots = 'slots' in availability && Array.isArray(availability.slots) ? availability.slots : [];
    const accepted = slots.some((s: { professionalId: string; startTime: string; endTime: string }) => s.professionalId === action.professionalId && s.startTime === localStart.time && s.endTime === localEnd.time);
    if (!accepted) return { kind: 'error', code: 'slot_unavailable' };
    const row = await this.db.insertInto('appointments').values({ professional_id: action.professionalId, customer_id: customerId, service_id: action.serviceId, status: 'hold', scheduled_start_at: start, scheduled_end_at: end, scheduled_local_date: localStart.date, scheduled_local_start_time: localStart.time, timezone: 'America/Sao_Paulo', price_cents: service.base_price_cents, duration_minutes: duration, before_buffer_minutes: before, after_buffer_minutes: after, hold_expires_at: new Date(Date.now() + 5 * 60_000) }).returning(['id']).executeTakeFirstOrThrow();
    return { kind: 'hold', appointmentId: row.id, serviceName: service.name, professionalName: professional.display_name, priceCents: service.base_price_cents, date: localStart.date, startTime: localStart.time, endTime: localEnd.time };
  }

  private async confirm(customerId: string, id: string) {
    const row = await this.db.updateTable('appointments').set({ status: 'confirmed', confirmed_at: new Date(), hold_expires_at: null }).where('id', '=', id).where('customer_id', '=', customerId).where('status', '=', 'hold').where('hold_expires_at', '>', new Date()).returning(['id', 'service_id', 'professional_id', 'scheduled_start_at', 'scheduled_end_at', 'price_cents']).executeTakeFirst();
    if (!row) return { kind: 'error', code: 'hold_unavailable' };
    const [service, professional] = await Promise.all([this.db.selectFrom('services').select('name').where('id','=',row.service_id).executeTakeFirstOrThrow(), this.db.selectFrom('professionals').select('display_name').where('id','=',row.professional_id).executeTakeFirstOrThrow()]);
    const start = toSaoPauloWallClock(new Date(row.scheduled_start_at)), end = toSaoPauloWallClock(new Date(row.scheduled_end_at));
    return { kind: 'confirmed', appointmentId: row.id, serviceName: service.name, professionalName: professional.display_name, priceCents: row.price_cents, date: start.date, startTime: start.time, endTime: end.time };
  }

  private async cancel(customerId: string, id: string) {
    const row = await this.db.updateTable('appointments').set({ status: 'cancelled', cancelled_at: new Date(), cancellation_reason: 'customer_request' }).where('id', '=', id).where('customer_id', '=', customerId).where('status', 'in', ['hold', 'confirmed']).returning(['id']).executeTakeFirst();
    return row ? { kind: 'cancelled', appointmentId: row.id } : { kind: 'error', code: 'appointment_not_found' };
  }
}
