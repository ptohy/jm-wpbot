import type { AppointmentStatus } from '../db/types.js';

export type AppointmentActor = 'client' | 'admin' | 'professional' | 'system';

export class TransitionError extends Error {
  constructor(readonly from: AppointmentStatus, readonly to: AppointmentStatus, readonly actor: AppointmentActor) {
    super(`Invalid appointment transition: ${from} -> ${to} by ${actor}`);
    this.name = 'TransitionError';
  }
}

const transitions: Record<AppointmentStatus, Partial<Record<AppointmentActor, AppointmentStatus[]>>> = {
  hold: { client: ['confirmed'], admin: ['confirmed', 'cancelled'], professional: ['confirmed', 'cancelled'], system: ['expired'] },
  confirmed: { client: ['cancelled'], admin: ['cancelled', 'completed', 'no_show'], professional: ['cancelled', 'completed', 'no_show'] },
  cancelled: {}, completed: {}, no_show: {}, expired: {},
};

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus, actor: AppointmentActor): void {
  if (!transitions[from][actor]?.includes(to)) throw new TransitionError(from, to, actor);
}
