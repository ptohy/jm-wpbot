import { describe, expect, it } from 'vitest';
import { canRetry, isWithinCustomerCareWindow, reminderAt, reminderTemplate, retryAt, shouldSendReminder } from '../../apps/server/src/messaging/reminders.js';
const start = new Date('2026-09-05T15:00:00Z');
describe('reminders', () => {
  it('calculates due times', () => { expect(reminderAt(start, '24h').toISOString()).toBe('2026-09-04T15:00:00.000Z'); expect(reminderAt(start, '3h').toISOString()).toBe('2026-09-05T12:00:00.000Z'); });
  it('only sends due future reminders', () => { expect(shouldSendReminder(start, '3h', new Date('2026-09-05T13:00:00Z'))).toBe(true); expect(shouldSendReminder(start, '3h', new Date('2026-09-05T16:00:00Z'))).toBe(false); });
  it('enforces customer-care window', () => { expect(isWithinCustomerCareWindow(new Date('2026-09-04T13:00:00Z'), new Date('2026-09-05T12:00:00Z'))).toBe(true); expect(isWithinCustomerCareWindow(new Date('2026-09-04T11:59:00Z'), new Date('2026-09-05T12:00:00Z'))).toBe(false); });
  it('bounds retries', () => { expect(retryAt(1, new Date(0)).getTime()).toBe(5000); expect(retryAt(20, new Date(0)).getTime()).toBe(900000); expect(canRetry(5)).toBe(false); });
  it('renders approved template', () => { expect(reminderTemplate('24h', { id: 'a', date: '05/09/2026', time: '12:00', service: 'Limpeza' }).name).toBe('lembrete_agendamento_24h'); });
});
