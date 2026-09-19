import type { LunaAction, LunaToolExecutor } from './luna.js';
import { toSaoPauloWallClock } from '../domain/schedule.js';

export interface HubCustomer {
  name: string;
  phone: string;
  email?: string | null;
}

export interface HubLunaToolExecutorConfig {
  baseUrl: string;
  token: string;
  organizationId: string;
  fetch?: typeof globalThis.fetch;
  customerLookup?: (phone: string) => Promise<HubCustomer | null>;
}

type HubService = {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
};

type HubSlot = {
  professionalId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function localTimeRange(startAt: string, endAt: string) {
  const start = toSaoPauloWallClock(new Date(startAt));
  const end = toSaoPauloWallClock(new Date(endAt));
  return { date: start.date, startTime: start.time, endTime: end.time };
}

function dayStart(date: string): string {
  return `${date}T00:00:00-03:00`;
}

function dayEnd(date: string): string {
  return `${date}T23:59:59-03:00`;
}

export class HubLunaToolExecutor implements LunaToolExecutor {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly config: HubLunaToolExecutorConfig) {
    this.fetcher = config.fetch ?? globalThis.fetch;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
  }

  async execute(action: LunaAction, context?: { phone: string }): Promise<unknown> {
    if (!context?.phone) throw new Error('phone context is required');
    if (action.action === 'list_services') return this.listServices();
    if (action.action === 'list_availability') return this.availability(action.serviceId, action.date);
    if (action.action === 'hold_slot') return this.hold(context.phone, action);
    if (action.action === 'confirm_hold') return this.confirm(action.appointmentId);
    return this.cancel(action.appointmentId);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.token}`,
      'x-hub-organization': this.config.organizationId,
      'content-type': 'application/json',
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Hub internal request failed (${response.status})`);
    return await response.json() as T;
  }

  private async listServices() {
    const body = await this.request<{ services: HubService[] }>('/api/internal/jm/catalog', { method: 'GET' });
    return { kind: 'services', services: body.services };
  }

  private async availability(serviceId: string, date: string) {
    const query = new URLSearchParams({ serviceId, from: dayStart(date), to: dayEnd(date), slotIncrementMinutes: '30' });
    const [catalog, body] = await Promise.all([
      this.listServices(),
      this.request<{ slots: HubSlot[] }>(`/api/internal/jm/availability?${query.toString()}`, { method: 'GET' }),
    ]);
    const service = (catalog as { services: HubService[] }).services.find((item) => item.id === serviceId);
    return {
      kind: 'availability',
      serviceId,
      serviceName: service?.name ?? 'o serviço',
      date,
      slots: body.slots.map((slot) => ({
        professionalId: slot.professionalId,
        professionalName: 'profissional selecionado',
        ...localTimeRange(slot.startAt, slot.endAt),
      })),
    };
  }

  private async customer(phone: string): Promise<HubCustomer> {
    const found = await this.config.customerLookup?.(phone);
    return found ?? { name: phone, phone };
  }

  private async hold(phone: string, action: Extract<LunaAction, { action: 'hold_slot' }>) {
    const customer = await this.customer(phone);
    const [catalog, response] = await Promise.all([
      this.listServices(),
      this.request<{
        holdId: string;
        serviceId: string;
        professionalId: string;
        startAt: string;
        endAt: string;
        state: string;
      }>('/api/internal/jm/booking-holds', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `jm-wpbot:${phone}:${action.serviceId}:${action.professionalId}:${action.startAt}`,
          customer: { name: customer.name, phone: customer.phone, email: customer.email ?? null },
          professionalId: action.professionalId,
          serviceId: action.serviceId,
          startAt: action.startAt,
          sourceDetail: 'jm-wpbot',
        }),
      }),
    ]);
    const service = (catalog as { services: HubService[] }).services.find((item) => item.id === response.serviceId);
    return {
      kind: 'hold',
      appointmentId: response.holdId,
      serviceName: service?.name ?? 'serviço selecionado',
      professionalName: 'profissional selecionado',
      priceCents: service?.priceCents ?? 0,
      ...localTimeRange(response.startAt, response.endAt),
    };
  }

  private async confirm(holdId: string) {
    const response = await this.request<{
      appointmentId: string;
      totalPriceCents: number;
      startAt: string;
      endAt: string;
      currency: string;
    }>(`/api/internal/jm/booking-holds/${encodeURIComponent(holdId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      kind: 'confirmed',
      appointmentId: response.appointmentId,
      serviceName: 'serviço selecionado',
      professionalName: 'profissional selecionado',
      priceCents: response.totalPriceCents,
      ...localTimeRange(response.startAt, response.endAt),
    };
  }

  private async cancel(holdId: string) {
    const response = await this.request<{ holdId: string }>(`/api/internal/jm/booking-holds/${encodeURIComponent(holdId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return { kind: 'cancelled', appointmentId: response.holdId };
  }
}
