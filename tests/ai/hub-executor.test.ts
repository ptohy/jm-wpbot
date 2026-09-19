import { describe, expect, it } from 'vitest';
import { HubLunaToolExecutor } from '../../apps/server/src/ai/hub-executor.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('HubLunaToolExecutor', () => {
  it('lists services through the Hub internal catalog with fixed organization auth', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ services: [{ id: 'svc-1', name: 'Design de sobrancelhas', priceCents: 8500, durationMinutes: 60 }] });
    };
    const executor = new HubLunaToolExecutor({ baseUrl: 'https://hub.tohy.com.br', token: 'secret-token-123456', organizationId: 'org-1', fetch: fetcher as typeof fetch });

    const result = await executor.execute({ action: 'list_services' }, { phone: '5521999999999' });

    expect(result).toEqual({ kind: 'services', services: [{ id: 'svc-1', name: 'Design de sobrancelhas', priceCents: 8500, durationMinutes: 60 }] });
    expect(calls[0]!.url).toBe('https://hub.tohy.com.br/api/internal/jm/catalog');
    expect(calls[0]!.init?.headers).toMatchObject({ authorization: 'Bearer secret-token-123456', 'x-hub-organization': 'org-1' });
  });

  it('creates and confirms canonical Hub holds instead of local appointments', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/internal/jm/catalog')) return jsonResponse({ services: [{ id: 'svc-1', name: 'Design de sobrancelhas', priceCents: 8500, durationMinutes: 60 }] });
      if (String(url).endsWith('/api/internal/jm/booking-holds')) return jsonResponse({ holdId: 'hold-1', serviceId: 'svc-1', professionalId: 'pro-1', startAt: '2026-09-04T13:00:00.000Z', endAt: '2026-09-04T14:00:00.000Z', state: 'active' }, { status: 201 });
      if (String(url).endsWith('/api/internal/jm/booking-holds/hold-1/confirm')) return jsonResponse({ holdId: 'hold-1', appointmentId: 'apt-1', totalPriceCents: 8500, startAt: '2026-09-04T13:00:00.000Z', endAt: '2026-09-04T14:00:00.000Z', state: 'confirmed', status: 'booked' });
      throw new Error(`unexpected ${url}`);
    };
    const executor = new HubLunaToolExecutor({ baseUrl: 'https://hub.tohy.com.br/', token: 'secret-token-123456', organizationId: 'org-1', fetch: fetcher as typeof fetch, customerLookup: async () => ({ name: 'Maria Silva', phone: '5521999999999' }) });

    const hold = await executor.execute({ action: 'hold_slot', serviceId: 'svc-1', professionalId: 'pro-1', startAt: '2026-09-04T13:00:00.000Z', endAt: '2026-09-04T14:00:00.000Z' }, { phone: '5521999999999' });
    const confirm = await executor.execute({ action: 'confirm_hold', appointmentId: 'hold-1' }, { phone: '5521999999999' });

    expect(hold).toMatchObject({ kind: 'hold', appointmentId: 'hold-1', serviceName: 'Design de sobrancelhas', professionalName: 'profissional selecionado', priceCents: 8500, date: '2026-09-04', startTime: '10:00', endTime: '11:00' });
    const holdCall = calls.find((call) => call.init?.method === 'POST' && call.url.endsWith('/api/internal/jm/booking-holds'));
    expect(holdCall).toBeDefined();
    expect(JSON.parse(holdCall!.init!.body as string)).toMatchObject({ customer: { name: 'Maria Silva', phone: '5521999999999' }, professionalId: 'pro-1', serviceId: 'svc-1', startAt: '2026-09-04T13:00:00.000Z', sourceDetail: 'jm-wpbot' });
    expect(confirm).toMatchObject({ kind: 'confirmed', appointmentId: 'apt-1', priceCents: 8500, date: '2026-09-04', startTime: '10:00', endTime: '11:00' });
  });
});
