import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database, JsonValue } from '../db/types.js';
import type PgBoss from 'pg-boss';
import { enqueueConversation } from '../jobs/queue.js';
import {
  enqueueOutbound,
  markDeliveredByProviderMessageId,
  markFailedByProviderMessageId,
  markHubDeliveryReported,
  markHubDeliveryReportError,
} from '../messaging/outbox.js';
import { reportRelationshipDelivery } from './relationship-delivery.js';

export function verifyMetaSignature(raw: string, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const received = signature.slice(7); if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
export function registerMetaWebhook(app: FastifyInstance, db: Kysely<Database>, boss: PgBoss, opts: {
  verifyToken: string;
  appSecret: string;
  hubInternalBaseUrl?: string;
  hubInternalApiToken?: string;
  hubInternalOrganizationId?: string;
}) {
  app.get('/webhooks/meta', async (request, reply) => { const q = request.query as Record<string, string>; if (q['hub.verify_token'] !== opts.verifyToken) return reply.code(403).send(); return reply.send(q['hub.challenge']); });
  app.post('/webhooks/meta', { config: { rawBody: true } }, async (request, reply) => {
    const raw = (request as typeof request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
    const signature = request.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(raw, typeof signature === 'string' ? signature : undefined, opts.appSecret)) return reply.code(401).send();
    const payload = request.body as Record<string, unknown>;
    const eventId = createEventId(payload, raw, opts.appSecret);
    const inserted = await db.insertInto('inbound_events').values({ provider_event_id: eventId, payload: payload as JsonValue }).onConflict((oc) => oc.column('provider_event_id').doNothing()).returning('id').executeTakeFirst();
    if (inserted) {
      for (const status of extractStatuses(payload)) {
        if (status.status === 'delivered') {
          const row = await markDeliveredByProviderMessageId(db, status.id);
          if (
            row?.hub_intent_id &&
            opts.hubInternalBaseUrl &&
            opts.hubInternalApiToken &&
            opts.hubInternalOrganizationId
          ) {
            try {
              await reportRelationshipDelivery(
                {
                  hubBaseUrl: opts.hubInternalBaseUrl,
                  hubToken: opts.hubInternalApiToken,
                  organizationId: opts.hubInternalOrganizationId,
                  timeoutMs: 10000,
                },
                row.hub_intent_id,
                { status: 'delivered', providerMessageId: status.id },
              );
              await markHubDeliveryReported(db, row.id);
            } catch (error) {
              await markHubDeliveryReportError(
                db,
                row.id,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        } else if (status.status === 'failed') {
          const errorCode = status.errorCode ?? 'meta_delivery_failed';
          const row = await markFailedByProviderMessageId(
            db,
            status.id,
            errorCode,
          );
          if (
            row?.hub_intent_id &&
            opts.hubInternalBaseUrl &&
            opts.hubInternalApiToken &&
            opts.hubInternalOrganizationId
          ) {
            try {
              await reportRelationshipDelivery(
                {
                  hubBaseUrl: opts.hubInternalBaseUrl,
                  hubToken: opts.hubInternalApiToken,
                  organizationId: opts.hubInternalOrganizationId,
                  timeoutMs: 10000,
                },
                row.hub_intent_id,
                { status: 'failed', errorCode },
              );
              await markHubDeliveryReported(db, row.id);
            } catch (error) {
              await markHubDeliveryReportError(
                db,
                row.id,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        }
      }

      for (const message of extractMessages(payload)) {
        const customer = await db.insertInto('customers').values({ whatsapp_phone: message.phone, display_name: message.name ?? null })
          .onConflict((oc) => oc.column('whatsapp_phone').doUpdateSet({ display_name: message.name ?? null, updated_at: new Date() as any }))
          .returning('id').executeTakeFirstOrThrow();
        const existing = await db.selectFrom('conversations').select('id').where('customer_id', '=', customer.id).where('status', '=', 'open').orderBy('updated_at desc').executeTakeFirst();
        const current = existing ?? await db.insertInto('conversations').values({ customer_id: customer.id }).returning('id').executeTakeFirstOrThrow();
        await db.insertInto('messages').values({ conversation_id: current.id, provider_message_id: message.id, direction: 'inbound', message_type: message.type, body: message.body, payload: message.payload as JsonValue, occurred_at: message.occurredAt }).onConflict((oc) => oc.column('provider_message_id').doNothing()).execute();
        await db.updateTable('conversations').set({ last_message_at: message.occurredAt as any, last_inbound_at: message.occurredAt as any, updated_at: new Date() as any }).where('id', '=', current.id).execute();

        const fiscalInvoiceId = extractFiscalEmailCopyInvoiceId(message.payload);
        if (fiscalInvoiceId && opts.hubInternalBaseUrl && opts.hubInternalApiToken && opts.hubInternalOrganizationId) {
          try {
            const result = await requestFiscalEmailCopy(
              opts.hubInternalBaseUrl,
              opts.hubInternalApiToken,
              opts.hubInternalOrganizationId,
              fiscalInvoiceId,
            );
            const body = result.status === 'requested'
              ? 'Pronto. Enviei uma cópia da NFS-e por e-mail.'
              : result.reason === 'email_unavailable'
                ? 'Não encontrei um e-mail cadastrado para este cliente.'
                : result.reason === 'not_issued'
                  ? 'A NFS-e ainda não está autorizada para envio.'
                  : 'O envio por e-mail está desativado para este atendimento.';
            await enqueueOutbound(db, {
              customerId: customer.id,
              conversationId: current.id,
              payload: { type: 'text', text: { body } },
            });
          } catch {
            await enqueueOutbound(db, {
              customerId: customer.id,
              conversationId: current.id,
              payload: {
                type: 'text',
                text: { body: 'Não consegui enviar a cópia por e-mail agora. Tente novamente em instantes.' },
              },
            });
          }
          continue;
        }
        await enqueueConversation(boss, current.id);
      }
    }
    return reply.code(200).send({ status: 'accepted' });
  });
}
function extractStatuses(
  payload: Record<string, unknown>,
): Array<{ id: string; status: 'delivered' | 'failed'; errorCode?: string }> {
  const result: Array<{
    id: string;
    status: 'delivered' | 'failed';
    errorCode?: string;
  }> = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as any)?.changes)
      ? (entry as any).changes
      : [];
    for (const change of changes) {
      const statuses = Array.isArray((change as any)?.value?.statuses)
        ? (change as any).value.statuses
        : [];
      for (const status of statuses) {
        const value = String(status?.status ?? '');
        if (value !== 'delivered' && value !== 'failed') continue;
        const rawCode = status?.errors?.[0]?.code;
        const normalized = rawCode == null
          ? undefined
          : `meta_${String(rawCode).toLowerCase().replace(/[^a-z0-9._:-]+/g, '_')}`;
        result.push({
          id: String(status?.id ?? ''),
          status: value,
          ...(normalized ? { errorCode: normalized } : {}),
        });
      }
    }
  }
  return result.filter((status) => Boolean(status.id));
}

function createEventId(payload: Record<string, unknown>, raw: string, secret: string): string {
  const ids = extractMessages(payload).map((message) => message.id).filter(Boolean);
  return ids.length ? ids.join(',') : createHmac('sha256', secret).update(raw).digest('hex');
}
function extractMessages(payload: Record<string, unknown>): Array<{ id: string; phone: string; name?: string; type: string; body: string | null; payload: Record<string, unknown>; occurredAt: Date }> {
  const result: Array<{ id: string; phone: string; name?: string; type: string; body: string | null; payload: Record<string, unknown>; occurredAt: Date }> = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as any)?.changes) ? (entry as any).changes : [];
    for (const change of changes) for (const message of ((change as any)?.value?.messages ?? [])) {
      const contact = ((change as any)?.value?.contacts ?? []).find((item: any) => item.wa_id === message.from);
      const body = message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? null;
      result.push({ id: String(message.id), phone: String(message.from), name: contact?.profile?.name, type: String(message.type ?? 'unknown'), body, payload: message, occurredAt: new Date(Number(message.timestamp ?? Math.floor(Date.now() / 1000)) * 1000) });
    }
  }
  return result;
}

export function extractFiscalEmailCopyInvoiceId(payload: Record<string, unknown>): string | null {
  const interactive = payload.interactive as Record<string, unknown> | undefined;
  const reply = interactive?.button_reply as Record<string, unknown> | undefined;
  const interactiveId = typeof reply?.id === 'string' ? reply.id : null;
  const legacyButton = payload.button as Record<string, unknown> | undefined;
  const legacyId = typeof legacyButton?.payload === 'string' ? legacyButton.payload : null;
  const value = interactiveId ?? legacyId;
  if (!value?.startsWith('fiscal_email_copy:')) return null;
  const invoiceId = value.slice('fiscal_email_copy:'.length).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId) ? invoiceId : null;
}

async function requestFiscalEmailCopy(
  baseUrl: string,
  token: string,
  organizationId: string,
  invoiceId: string,
): Promise<{ status: 'requested' | 'skipped'; reason?: string }> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/internal/fiscal/invoice-email-copy`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-hub-service': 'jm-wpbot',
      'x-hub-organization': organizationId,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ invoiceId }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'Hub email-copy request failed');
  return {
    status: body.status === 'requested' ? 'requested' : 'skipped',
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  };
}
