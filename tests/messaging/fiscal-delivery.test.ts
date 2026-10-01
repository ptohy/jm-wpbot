import { describe, expect, it } from "vitest";
import { buildInvoiceIssuedPayload } from "../../apps/server/src/http/fiscal-delivery.js";

describe("fiscal WhatsApp delivery", () => {
  const invoiceId = "11111111-1111-4111-8111-111111111111";

  it("uses a single WhatsApp interactive button for email copy", () => {
    const payload = buildInvoiceIssuedPayload({
      invoiceId,
      number: "123",
      documentUrl: "https://example.test/nfse/123",
      allowEmailCopy: true,
    });
    expect(payload).toMatchObject({
      invoiceId,
      type: "interactive",
      interactive: {
        type: "button",
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
    });
  });

  it("does not expose an email action when email copy is disabled", () => {
    const payload = buildInvoiceIssuedPayload({
      invoiceId,
      number: "123",
      documentUrl: "",
      allowEmailCopy: false,
    });
    expect(payload).toMatchObject({
      invoiceId,
      type: "text",
      text: { body: "Sua NFS-e 123 foi emitida." },
    });
    expect(JSON.stringify(payload)).not.toContain("fiscal_email_copy");
  });
});
