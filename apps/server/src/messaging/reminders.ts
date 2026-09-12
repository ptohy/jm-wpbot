import type { JsonObject } from '../db/types.js';

export type ReminderKind = '24h' | '3h';
export const MAX_DELIVERY_ATTEMPTS = 5;
export const META_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function reminderAt(start: Date, kind: ReminderKind): Date {
  const hours = kind === '24h' ? 24 : 3;
  return new Date(start.getTime() - hours * 60 * 60 * 1000);
}

export function shouldSendReminder(start: Date, kind: ReminderKind, now = new Date()): boolean {
  const due = reminderAt(start, kind);
  return due.getTime() <= now.getTime() && start.getTime() > now.getTime();
}

export function isWithinCustomerCareWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < META_CUSTOMER_WINDOW_MS;
}

export function retryAt(attempt: number, now = new Date()): Date {
  const seconds = Math.min(15 * 60, 5 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + seconds * 1000);
}

export function canRetry(attempt: number): boolean { return attempt < MAX_DELIVERY_ATTEMPTS; }

export function reminderFreeText(kind: ReminderKind, appointment: { date: string; time: string; service: string }): string {
  return `Lembrete: seu atendimento de ${appointment.service} está confirmado para ${appointment.date} às ${appointment.time}.`;
}

export function reminderTemplate(kind: ReminderKind, appointment: { id: string; date: string; time: string; service: string }): JsonObject {
  return {
    name: kind === '24h' ? 'lembrete_agendamento_24h' : 'lembrete_agendamento_3h',
    language: { code: 'pt_BR' },
    components: [{ type: 'body', parameters: [
      { type: 'text', parameter_name: 'data', text: appointment.date },
      { type: 'text', parameter_name: 'hora', text: appointment.time },
      { type: 'text', parameter_name: 'servico', text: appointment.service },
    ] }],
    appointment_id: appointment.id,
  };
}

export function whatsappTemplatePayload(template: JsonObject): JsonObject {
  return { type: 'template', template };
}
