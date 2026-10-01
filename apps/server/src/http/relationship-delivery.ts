import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database, JsonObject } from '../db/types.js';
import { enqueueOutbound } from '../messaging/outbox.js';

type HubEnvelope = {
  intentId: string;
  idempotencyKey: string;
  organizationId: string;
  channel: 'whatsapp';
  destination: string;
  templateKey: string;
  templateVariables: Record<string, unknown>;
};

function bearer(request: { headers: Record<string, string | string[] | undefined> }) {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function interactiveMessage(
  body: string,
  buttons: Array<{ id: string; title: string }>,
): JsonObject {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: button,
        })),
      },
    },
  };
}

export function renderRelationshipIntent(envelope: HubEnvelope): JsonObject {
  const vars = envelope.templateVariables ?? {};

  if (envelope.templateKey === 'service-return-reminder') {
    const serviceId = asString(vars.serviceId);
    const serviceName = asString(vars.serviceName) ?? 'seu atendimento';
    if (!serviceId) throw new Error('service-return intent is missing serviceId');

    return interactiveMessage(
      `Oi! Está chegando o período ideal para manter o resultado de ${serviceName}. Quer que eu veja os próximos horários para você?`,
      [
        {
          id: `relationship_return_slots:${serviceId}`,
          title: 'Ver horários',
        },
        {
          id: 'relationship_later',
          title: 'Outro dia',
        },
        {
          id: 'relationship_human',
          title: 'Falar com alguém',
        },
      ],
    );
  }

  if (envelope.templateKey === 'package-renewal-offer') {
    const packageId = asString(vars.packageId);
    const packageName = asString(vars.packageName) ?? 'seu pacote';
    const remainingSessions = asNumber(vars.remainingSessions) ?? 1;
    if (!packageId) throw new Error('package-renewal intent is missing packageId');

    return interactiveMessage(
      `Seu ${packageName} está com ${remainingSessions} sessão restante. Quer renovar agora e manter suas próximas sessões garantidas?`,
      [
        {
          id: `relationship_package_renew:${packageId}`,
          title: 'Renovar pacote',
        },
        {
          id: 'relationship_later',
          title: 'Agora não',
        },
        {
          id: 'relationship_human',
          title: 'Falar com alguém',
        },
      ],
    );
  }

  throw new Error(`Unsupported relationship template: ${envelope.templateKey}`);
}

async function fetchIntent(
  baseUrl: string,
  token: string,
  organizationId: string,
  intentId: string,
  timeoutMs: number,
): Promise<HubEnvelope | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/internal/automations/communication-intents/${encodeURIComponent(intentId)}`,
      {
        method: 'GET',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          'x-hub-service': 'jm-wpbot',
          'x-hub-organization': organizationId,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Hub intent request failed (${response.status})`);
    }
    const body = (await response.json()) as { item?: HubEnvelope | null };
    return body.item ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export function registerRelationshipDelivery(
  app: FastifyInstance,
  db: Kysely<Database>,
  options: {
    internalToken: string;
    hubBaseUrl: string;
    hubToken: string;
    organizationId: string;
    timeoutMs: number;
  },
) {
  app.post(
    '/internal/automations/communication-intents/:intentId',
    async (request, reply) => {
      if (bearer(request as any) !== options.internalToken) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const { intentId } = request.params as { intentId?: string };
      if (
        !intentId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId)
      ) {
        return reply.code(400).send({ error: 'invalid_intent_id' });
      }

      const envelope = await fetchIntent(
        options.hubBaseUrl,
        options.hubToken,
        options.organizationId,
        intentId,
        options.timeoutMs,
      );
      if (!envelope) return reply.code(204).send();
      if (
        envelope.organizationId !== options.organizationId ||
        envelope.channel !== 'whatsapp'
      ) {
        return reply.code(403).send({ error: 'intent_scope_mismatch' });
      }

      const customer = await db
        .insertInto('customers')
        .values({
          whatsapp_phone: envelope.destination,
          display_name: null,
        })
        .onConflict((oc) =>
          oc.column('whatsapp_phone').doUpdateSet({
            updated_at: new Date() as any,
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      const outboxId = await enqueueOutbound(db, {
        customerId: customer.id,
        hubIntentId: envelope.intentId,
        payload: renderRelationshipIntent(envelope),
      });

      return reply.code(outboxId ? 202 : 200).send({
        status: outboxId ? 'queued' : 'already_queued',
        intentId: envelope.intentId,
      });
    },
  );
}
