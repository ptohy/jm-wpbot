import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { enqueueOutbound } from '../messaging/outbox.js';
import { mediaFallback, type MediaTranscriber } from '../media/transcription.js';

export interface ConversationResponder {
  respond(input: { phone: string; messages: Array<{ body: string | null; messageType: string }> }): Promise<string | null>;
}

/** Safe until the Luna adapter is installed: never invents availability or prices. */
export const unavailableResponder: ConversationResponder = {
  async respond() { return 'Recebi sua mensagem. Vou verificar os detalhes dos atendimentos e já retorno.'; },
};

export async function processConversationTurn(tx: Transaction<Database>, conversationId: string, responder: ConversationResponder = unavailableResponder, transcriber?: MediaTranscriber): Promise<void> {
  const conversation = await tx.selectFrom('conversations').innerJoin('customers', 'customers.id', 'conversations.customer_id')
    .select(['conversations.id', 'conversations.customer_id', 'conversations.ai_paused_at', 'customers.whatsapp_phone'])
    .where('conversations.id', '=', conversationId).executeTakeFirst();
  if (!conversation || conversation.ai_paused_at) return;
  const stored = await tx.selectFrom('messages').select(['id', 'body', 'message_type as messageType', 'payload', 'media_transcription_status as transcriptionStatus', 'media_transcription_text as transcriptionText'])
    .where('conversation_id', '=', conversationId).where('direction', '=', 'inbound')
    .orderBy('occurred_at').orderBy('id').limit(30).execute();
  if (!stored.length) return;
  const messages = [] as Array<{ body: string | null; messageType: string }>;
  for (const message of stored) {
    if (message.body || !['audio', 'image', 'video', 'document', 'sticker'].includes(message.messageType)) {
      messages.push({ body: message.body, messageType: message.messageType });
      continue;
    }
    const media = (message.payload as Record<string, unknown>)[message.messageType] as Record<string, unknown> | undefined;
    const id = typeof media?.id === 'string' ? media.id : undefined;
    try {
      const terminalTranscription = message.transcriptionStatus === 'failed' || message.transcriptionStatus === 'rejected';
      const body = message.transcriptionStatus === 'completed' ? message.transcriptionText : !terminalTranscription && transcriber && message.messageType === 'audio' && id ? await transcriber.transcribe({ id, mimeType: typeof media?.mime_type === 'string' ? media.mime_type : undefined, seconds: typeof media?.duration === 'number' ? media.duration : undefined }) : null;
      if (message.messageType === 'audio' && id && body) await tx.updateTable('messages').set({ media_transcription_status: 'completed', media_transcription_text: body, media_transcription_error: null }).where('id', '=', message.id).execute();
      messages.push({ body: body ?? mediaFallback(message.messageType), messageType: body ? 'audio_transcription' : message.messageType });
    } catch (error) {
      if (message.messageType === 'audio' && id) await tx.updateTable('messages').set({ media_transcription_status: error instanceof Error && error.name === 'MediaRejectedError' ? 'rejected' : 'failed', media_transcription_error: error instanceof Error ? error.message.slice(0, 200) : 'transcription failed' }).where('id', '=', message.id).execute();
      messages.push({ body: mediaFallback(message.messageType), messageType: message.messageType });
    }
  }
  const response = await responder.respond({ phone: conversation.whatsapp_phone, messages });
  if (!response?.trim()) return;
  await enqueueOutbound(tx, { customerId: conversation.customer_id, conversationId, payload: { type: 'text', text: { body: response } } });
}
