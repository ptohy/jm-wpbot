import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { enqueueOutbound } from '../messaging/outbox.js';

export interface ConversationResponder {
  respond(input: { phone: string; messages: Array<{ body: string | null; messageType: string }> }): Promise<string | null>;
}

/** Safe until the Luna adapter is installed: never invents availability or prices. */
export const unavailableResponder: ConversationResponder = {
  async respond() { return 'Recebi sua mensagem. Vou verificar os detalhes dos atendimentos e já retorno.'; },
};

export async function processConversationTurn(tx: Transaction<Database>, conversationId: string, responder: ConversationResponder = unavailableResponder): Promise<void> {
  const conversation = await tx.selectFrom('conversations').innerJoin('customers', 'customers.id', 'conversations.customer_id')
    .select(['conversations.id', 'conversations.customer_id', 'conversations.ai_paused_at', 'customers.whatsapp_phone'])
    .where('conversations.id', '=', conversationId).executeTakeFirst();
  if (!conversation || conversation.ai_paused_at) return;
  const messages = await tx.selectFrom('messages').select(['body', 'message_type as messageType'])
    .where('conversation_id', '=', conversationId).where('direction', '=', 'inbound')
    .orderBy('occurred_at').orderBy('id').limit(30).execute();
  if (!messages.length) return;
  const response = await responder.respond({ phone: conversation.whatsapp_phone, messages });
  if (!response?.trim()) return;
  await enqueueOutbound(tx, { customerId: conversation.customer_id, conversationId, payload: { type: 'text', text: { body: response } } });
}
