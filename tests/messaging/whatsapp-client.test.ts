import { describe, expect, it } from 'vitest';
import { CloudWhatsAppClient } from '../../apps/server/src/messaging/whatsapp-client.js';

describe('CloudWhatsAppClient', () => {
  it('sends through injectable transport without exposing credentials', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const client = new CloudWhatsAppClient('secret-token', 'phone-1', 'v23.0', async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    });
    await expect(client.sendText('5511999999999', 'oi')).resolves.toEqual({ providerMessageId: 'wamid.1' });
    expect(captured?.url).toContain('/v23.0/phone-1/messages');
    expect(captured?.init.body).toContain('oi');
    expect(captured?.init.body).not.toContain('secret-token');
  });

  it('fails closed on provider errors and timeout', async () => {
    const errorClient = new CloudWhatsAppClient('secret-token', 'phone-1', 'v23.0', async () => new Response('private provider detail', { status: 500 }));
    await expect(errorClient.sendText('5511', 'oi')).rejects.toEqual(expect.objectContaining({ name: 'WhatsAppProviderError' }));
    await expect(errorClient.sendText('5511', 'oi')).rejects.not.toThrow('private provider detail');

    const timeoutClient = new CloudWhatsAppClient('secret-token', 'phone-1', 'v23.0', async (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }), 1);
    await expect(timeoutClient.sendText('5511', 'oi')).rejects.toThrow('timed out');
  });
});
