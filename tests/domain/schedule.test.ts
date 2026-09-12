import { describe, expect, it } from 'vitest';
import {
  ScheduleValidationError,
  listAvailableSlots,
  toSaoPauloInstant,
  toSaoPauloWallClock,
} from '../../apps/server/src/domain/schedule.js';

describe('Sao Paulo scheduling', () => {
  it('converts a Sao Paulo wall-clock time into the persisted UTC instant', () => {
    const instant = toSaoPauloInstant('2026-09-04', '10:30');

    expect(instant.toISOString()).toBe('2026-09-04T13:30:00.000Z');
    expect(toSaoPauloWallClock(instant)).toEqual({ date: '2026-09-04', time: '10:30' });
  });

  it('removes a slot whose service buffer meets an existing appointment buffer', () => {
    const slots = listAvailableSlots({
      date: '2026-09-04',
      workHours: [{ startTime: '09:00', endTime: '14:00' }],
      durationMinutes: 60,
      beforeBufferMinutes: 15,
      afterBufferMinutes: 15,
      intervalMinutes: 30,
      appointments: [{ startAt: new Date('2026-09-04T14:00:00Z'), endAt: new Date('2026-09-04T15:00:00Z'), beforeBufferMinutes: 15, afterBufferMinutes: 15 }],
      now: new Date('2026-09-01T00:00:00Z'),
    });

    expect(slots.map((slot) => slot.localStartTime)).toEqual(['09:15', '12:15', '12:45']);
  });

  it('subtracts schedule blocks and never returns a past slot', () => {
    const slots = listAvailableSlots({
      date: '2026-09-04',
      workHours: [{ startTime: '09:00', endTime: '12:00' }],
      durationMinutes: 30,
      intervalMinutes: 30,
      blocks: [{ startAt: new Date('2026-09-04T13:30:00Z'), endAt: new Date('2026-09-04T14:00:00Z') }],
      now: new Date('2026-09-04T13:20:00Z'),
    });

    expect(slots.map((slot) => slot.localStartTime)).toEqual(['10:00', '11:00', '11:30']);
  });

  it('rejects an invalid work interval', () => {
    expect(() => listAvailableSlots({
      date: '2026-09-04',
      workHours: [{ startTime: '12:00', endTime: '09:00' }],
      durationMinutes: 30,
      now: new Date('2026-09-01T00:00:00Z'),
    })).toThrow(ScheduleValidationError);
  });
});
