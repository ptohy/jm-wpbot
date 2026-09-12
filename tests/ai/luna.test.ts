import { describe, expect, it } from 'vitest';
import { LunaAdapter, renderFacts } from '../../apps/server/src/ai/luna.js';

describe('LunaAdapter', () => {
  it('validates tool arguments and renders appointment facts deterministically', async () => {
    let called: unknown;
    const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ action: 'hold_slot', serviceId: 's1', professionalId: 'p1', startAt: '2026-09-10T15:00:00.000Z', endAt: '2026-09-10T15:30:00.000Z' }) } }] } }] }), { status: 200 });
    const adapter = new LunaAdapter({ apiKey: 'test', fetch: fetcher }, { execute: async action => { called = action; return { kind: 'hold', serviceName: 'Limpeza', date: '10/09/2026', startTime: '12:00', endTime: '12:30', professionalName: 'Jessica', priceCents: 12000 }; } });
    const result = await adapter.respond({ phone: '5521', messages: [{ body: 'amanhã', messageType: 'text' }] });
    expect(called).toMatchObject({ action: 'hold_slot', serviceId: 's1' });
    expect(result).toContain('R$ 120,00');
    expect(result).toContain('10/09/2026');
  });

  it('rejects malformed tool arguments', async () => {
    const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: '{"action":"hold_slot"}' } }] } }] }), { status: 200 });
    const adapter = new LunaAdapter({ apiKey: 'test', fetch: fetcher }, { execute: async () => ({}) });
    await expect(adapter.respond({ phone: '5521', messages: [{ body: 'oi', messageType: 'text' }] })).rejects.toThrow('invalid tool action');
  });
});

it('renderer never accepts model-provided prose for facts', () => {
  expect(renderFacts({ kind: 'confirmed', serviceName: 'Design', date: '11/09/2026', startTime: '10:00', endTime: '11:00', professionalName: 'Jessica' })).toBe('Agendamento confirmado: Design, 11/09/2026 das 10:00 às 11:00, com Jessica.');
});
