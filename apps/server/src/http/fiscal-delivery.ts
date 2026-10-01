import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database, JsonObject } from "../db/types.js";
import { enqueueOutbound } from "../messaging/outbox.js";

function auth(request: any, token: string): boolean {
  const value = request.headers.authorization;
  return typeof value === "string" && value === `Bearer ${token}`;
}

export function registerFiscalDelivery(app: FastifyInstance, db: Kysely<Database>, token: string) {
  app.post("/internal/fiscal/invoice-issued", async (request, reply) => {
    if (!auth(request, token)) return reply.code(401).send();

    const body = request.body as Record<string, unknown>;
    const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const number = typeof body.number === "string" ? body.number.trim() : "autorizada";
    const documentUrl = typeof body.documentUrl === "string" ? body.documentUrl.trim() : "";
    const allowEmailCopy = body.allowEmailCopy === true;

    if (!invoiceId || !phone) return reply.code(400).send({ error: "invoiceId and phone are required" });

    const existing = await db.selectFrom("outbox_messages")
      .select("id")
      .where("customer_id", "in", db.selectFrom("customers").select("id").where("whatsapp_phone", "=", phone))
      .where(sql<boolean>`payload->>'invoiceId' = ${invoiceId}`)
      .limit(1)
      .executeTakeFirst();
    if (existing) return reply.send({ status: "already_queued", outboxId: existing.id });

    const customer = await db.insertInto("customers")
      .values({ whatsapp_phone: phone })
      .onConflict((oc) => oc.column("whatsapp_phone").doUpdateSet({ updated_at: new Date() as any }))
      .returning("id")
      .executeTakeFirstOrThrow();

    const conversation = await db.selectFrom("conversations")
      .select("id")
      .where("customer_id", "=", customer.id)
      .where("status", "=", "open")
      .orderBy("updated_at desc")
      .executeTakeFirst();

    const current = conversation ?? await db.insertInto("conversations")
      .values({ customer_id: customer.id })
      .returning("id")
      .executeTakeFirstOrThrow();

    const text = documentUrl
      ? `Sua NFS-e ${number} foi emitida. Consulte o documento: ${documentUrl}`
      : `Sua NFS-e ${number} foi emitida.`;
    const payload: JsonObject = allowEmailCopy
      ? {
          invoiceId,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text },
            action: {
              buttons: [{
                type: "reply",
                reply: {
                  id: `fiscal_email_copy:${invoiceId}`,
                  title: "Enviar por e-mail",
                },
              }],
            },
          },
        }
      : {
          invoiceId,
          type: "text",
          text: { body: text },
        };

    const outboxId = await enqueueOutbound(db, {
      customerId: customer.id,
      conversationId: current.id,
      payload,
    });
    return reply.send({ status: "queued", outboxId });
  });
}
