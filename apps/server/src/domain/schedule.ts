export const TIMEZONE = 'America/Sao_Paulo';
export class ScheduleValidationError extends Error { constructor(message: string) { super(message); this.name = 'ScheduleValidationError'; } }
type Window = { startTime: string; endTime: string };
type Occupied = { startAt: Date; endAt: Date; beforeBufferMinutes?: number; afterBufferMinutes?: number };
type Block = { startAt: Date; endAt: Date };
export type AvailableSlot = { startAt: Date; endAt: Date; localStartTime: string; localEndTime: string };
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function dateParts(value: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!m) throw new ScheduleValidationError(`Invalid local date: ${value}`);
  const y = +m[1], mo = +m[2], d = +m[3], check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new ScheduleValidationError(`Invalid local date: ${value}`);
  return [y, mo, d];
}
function minuteValue(value: string): number { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new ScheduleValidationError(`Invalid local time: ${value}`); const [h, m] = value.split(':').map(Number); return h * 60 + m; }
const pad = (v: number) => String(v).padStart(2, '0');
function wall(instant: Date): { date: string; time: string } {
  if (Number.isNaN(instant.getTime())) throw new ScheduleValidationError('instant must be a valid date');
  const p = Object.fromEntries(formatter.formatToParts(instant).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function toSaoPauloWallClock(instant: Date) { return wall(instant); }
export function toSaoPauloInstant(date: string, time: string): Date {
  const [y, mo, d] = dateParts(date), minute = minuteValue(time), candidate = Date.UTC(y, mo - 1, d, Math.floor(minute / 60), minute % 60);
  const p = Object.fromEntries(formatter.formatToParts(new Date(candidate)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute), result = new Date(candidate - (shown - candidate));
  if (wall(result).date !== date || wall(result).time !== time) throw new ScheduleValidationError(`Invalid or ambiguous local time: ${date} ${time}`);
  return result;
}
export interface ListSlotsInput { date: string; workHours: Window[]; durationMinutes: number; beforeBufferMinutes?: number; afterBufferMinutes?: number; intervalMinutes?: number; appointments?: Occupied[]; blocks?: Block[]; now?: Date; }
export function listAvailableSlots(input: ListSlotsInput): AvailableSlot[] {
  dateParts(input.date); if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) throw new ScheduleValidationError('durationMinutes must be positive');
  const before = input.beforeBufferMinutes ?? 0, after = input.afterBufferMinutes ?? 0, interval = input.intervalMinutes ?? 30;
  if (![before, after].every(n => Number.isInteger(n) && n >= 0)) throw new ScheduleValidationError('buffer minutes must be non-negative integers');
  if (!Number.isInteger(interval) || interval <= 0) throw new ScheduleValidationError('intervalMinutes must be positive');
  const windows = input.workHours.map(w => ({ start: minuteValue(w.startTime), end: minuteValue(w.endTime) })); if (windows.some(w => w.end <= w.start)) throw new ScheduleValidationError('Work interval must end after start');
  const occupied = [...(input.appointments ?? []).map(a => ({ start: a.startAt.getTime() - (a.beforeBufferMinutes ?? 0) * 60000, end: a.endAt.getTime() + (a.afterBufferMinutes ?? 0) * 60000 })), ...(input.blocks ?? []).map(b => { if (b.endAt <= b.startAt) throw new ScheduleValidationError('Block must end after start'); return { start: b.startAt.getTime(), end: b.endAt.getTime() }; })];
  const now = input.now?.getTime() ?? Date.now(), result: AvailableSlot[] = [];
  for (const window of windows) for (let start = window.start + before; start + input.durationMinutes + after <= window.end; start += interval) {
    const end = start + input.durationMinutes, localStartTime = `${pad(Math.floor(start / 60))}:${pad(start % 60)}`, localEndTime = `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
    const startAt = toSaoPauloInstant(input.date, localStartTime), endAt = toSaoPauloInstant(input.date, localEndTime), occupiedStart = startAt.getTime(), occupiedEnd = endAt.getTime() + after * 60000;
    if (occupiedEnd <= now || occupied.some(x => occupiedStart < x.end && occupiedEnd > x.start)) continue;
    result.push({ startAt, endAt, localStartTime, localEndTime });
  } return result;
}
