export interface WhatsAppClient {
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>;
  sendPayload(to: string, payload: Record<string, unknown>): Promise<{ providerMessageId: string }>;
}

export class CloudWhatsAppClient implements WhatsAppClient {
  constructor(private readonly token: string, private readonly phoneNumberId: string, private readonly apiVersion = 'v23.0') {}
  private async send(to: string, body: Record<string, unknown>) {
    const response = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...body }),
    });
    if (!response.ok) throw new Error(`WhatsApp delivery failed (${response.status})`);
    const json = await response.json() as { messages?: Array<{ id?: string }> };
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp response did not include a message id');
    return { providerMessageId: id };
  }
  sendText(to: string, body: string) { return this.send(to, { type: 'text', text: { body } }); }
  sendPayload(to: string, payload: Record<string, unknown>) { return this.send(to, payload); }
}
