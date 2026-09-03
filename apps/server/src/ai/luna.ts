import { z } from 'zod';

export const LunaAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_services') }),
  z.object({ action: z.literal('list_availability'), serviceId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal('hold_slot'), serviceId: z.string().min(1), professionalId: z.string().min(1), startAt: z.string().datetime(), endAt: z.string().datetime() }),
  z.object({ action: z.literal('confirm_hold'), appointmentId: z.string().min(1) }),
  z.object({ action: z.literal('cancel_appointment'), appointmentId: z.string().min(1) }),
]);
export type LunaAction = z.infer<typeof LunaAction>;

export interface LunaToolExecutor { execute(action: LunaAction, context?: { phone: string }): Promise<unknown>; }
export interface LunaConfig { apiKey: string; model?: string; baseUrl?: string; fetch?: typeof globalThis.fetch; }
export interface LunaInput { phone: string; messages: Array<{ body: string | null; messageType: string }>; }

const system = `Você é o atendente de uma clínica de estética facial. Seja natural e objetivo, em português do Brasil. Use as ferramentas para consultar e alterar a agenda. Nunca invente serviço, preço, duração, profissional, data ou horário. Não confirme por texto fatos que não vieram de uma ferramenta. Para preço, data, hora e confirmação use exclusivamente os marcadores FACTS retornados pela aplicação.`;

export class LunaAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly config: LunaConfig, private readonly tools: LunaToolExecutor) { this.fetcher = config.fetch ?? globalThis.fetch; }
  async respond(input: LunaInput): Promise<string | null> {
    const endpoint = `${this.config.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`;
    let messages: Array<Record<string, unknown>> = [{ role: 'system', content: system }, ...input.messages.map(m => ({ role: 'user', content: m.body ?? `[${m.messageType}]` }))];
    let lastFacts: unknown = { kind: 'fallback' };
    for (let round = 0; round < 5; round++) {
    const response = await this.fetcher(endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.model ?? 'gpt-5.6-luna', temperature: 0.2, messages, tools: toolSchemas, tool_choice: 'auto' }),
    });
    if (!response.ok) throw new Error(`Luna request failed (${response.status})`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }> } }> };
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error('Luna response missing message');
    if (!message.tool_calls?.length) return message.content?.trim() || null;
    // Execute each tool call, then give the tool results back to Luna. This is
    // required for a complete turn (e.g. hold_slot followed by confirmation).
    const toolMessages: Array<Record<string, unknown>> = [];
    for (const call of message.tool_calls) {
      let raw: unknown;
      try { raw = JSON.parse(call.function.arguments); } catch { throw new Error('Luna returned invalid JSON tool arguments'); }
      const parsed = LunaAction.safeParse(raw);
      if (!parsed.success) throw new Error('Luna returned an invalid tool action');
      const facts = await this.tools.execute(parsed.data, { phone: input.phone });
      lastFacts = facts;
      toolMessages.push({ role: 'tool', tool_call_id: call.id ?? call.function.name, content: JSON.stringify(facts) });
    }
    messages = [...messages, message as Record<string, unknown>, ...toolMessages];
    }
    return renderFacts(lastFacts);
    }
  }

const toolSchemas = [
  { type: 'function', function: { name: 'list_services', description: 'Lista serviços ativos e seus preços.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'list_availability', description: 'Consulta horários livres.', parameters: { type: 'object', required: ['serviceId', 'date'], properties: { serviceId: { type: 'string' }, date: { type: 'string', format: 'date' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'hold_slot', description: 'Cria uma reserva temporária de cinco minutos.', parameters: { type: 'object', required: ['serviceId', 'professionalId', 'startAt', 'endAt'], properties: { serviceId: { type: 'string' }, professionalId: { type: 'string' }, startAt: { type: 'string', format: 'date-time' }, endAt: { type: 'string', format: 'date-time' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'confirm_hold', description: 'Confirma uma reserva temporária.', parameters: { type: 'object', required: ['appointmentId'], properties: { appointmentId: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'cancel_appointment', description: 'Cancela uma reserva.', parameters: { type: 'object', required: ['appointmentId'], properties: { appointmentId: { type: 'string' } }, additionalProperties: false } } },
];

export function renderFacts(value: unknown): string {
  const v = value as { kind?: string; text?: string; serviceName?: string; priceCents?: number; date?: string; startTime?: string; endTime?: string; professionalName?: string; appointmentId?: string };
  if (v.kind === 'services') return 'Estes são os serviços disponíveis:\n' + ((value as { services?: Array<{ name: string; priceCents: number }> }).services ?? []).map(s => `• ${s.name} — R$ ${(s.priceCents / 100).toFixed(2).replace('.', ',')}`).join('\n');
  if (v.kind === 'availability') return `Horários disponíveis para ${v.serviceName ?? 'o serviço'} em ${v.date}:\n${((value as { slots?: Array<{ startTime: string; endTime: string }> }).slots ?? []).map(s => `• ${s.startTime}–${s.endTime}`).join('\n') || 'Não há horários disponíveis.'}`;
  if (v.kind === 'hold') return `Confira: ${v.serviceName}, ${v.date} das ${v.startTime} às ${v.endTime}, com ${v.professionalName}. Valor: R$ ${((v.priceCents ?? 0) / 100).toFixed(2).replace('.', ',')}. Responda “confirmar” para concluir.`;
  if (v.kind === 'confirmed') return `Agendamento confirmado: ${v.serviceName}, ${v.date} das ${v.startTime} às ${v.endTime}, com ${v.professionalName}.${typeof v.priceCents === 'number' ? ` Valor: R$ ${(v.priceCents / 100).toFixed(2).replace('.', ',')}.` : ''}`;
  return 'Não consegui obter os dados da agenda. Vou encaminhar para atendimento.';
}

export function createLunaResponder(config: LunaConfig, tools: LunaToolExecutor) {
  const adapter = new LunaAdapter(config, tools);
  return { respond: (input: LunaInput) => adapter.respond(input) };
}
