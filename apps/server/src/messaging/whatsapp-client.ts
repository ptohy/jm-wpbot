export interface WhatsAppClient {
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>;
  sendPayload(to: string, payload: Record<string, unknown>): Promise<{ providerMessageId: string }>;
}

export type WhatsAppTransport = (url: string, init: RequestInit) => Promise<Response>;
export class WhatsAppProviderError extends Error {
  constructor(message = 'WhatsApp delivery failed') { super(message); this.name = 'WhatsAppProviderError'; }
}

export class CloudWhatsAppClient implements WhatsAppClient {
  constructor(private readonly token: string, private readonly phoneNumberId: string, private readonly apiVersion = 'v23.0', private readonly fetcher: WhatsAppTransport = globalThis.fetch, private readonly timeoutMs = 10000) {}
  private async send(to: string, body: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
        method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, ...body }),
      });
      if (!response.ok) throw new WhatsAppProviderError();
      const json = await response.json() as { messages?: Array<{ id?: string }> };
      const id = json.messages?.[0]?.id;
      if (!id) throw new WhatsAppProviderError('WhatsApp response was invalid');
      return { providerMessageId: id };
    } catch (error) {
      if (error instanceof WhatsAppProviderError) throw error;
      throw new WhatsAppProviderError(controller.signal.aborted ? 'WhatsApp delivery timed out' : 'WhatsApp delivery failed');
    } finally { clearTimeout(timer); }
  }
  sendText(to: string, body: string) { return this.send(to, { type: 'text', text: { body } }); }
  sendPayload(to: string, payload: Record<string, unknown>) { return this.send(to, payload); }
}
