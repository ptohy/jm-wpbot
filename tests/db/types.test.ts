import { describe, expect, it } from 'vitest';
import type { Insertable } from 'kysely';
import type { MessagesTable, OutboxMessagesTable } from '../../apps/server/src/db/types.js';

describe('database JSON types', () => {
  it('accepts provider payload arrays and scalar JSON values', () => {
    const message: Insertable<MessagesTable> = {
      conversation_id: 'conversation-1',
      direction: 'inbound',
      message_type: 'interactive',
      payload: ['button_reply', 1, { id: 'schedule' }],
      occurred_at: new Date('2026-09-04T13:00:00Z'),
    };
    const outbox: Insertable<OutboxMessagesTable> = {
      customer_id: 'customer-1',
      payload: true,
      delivery_due_at: new Date('2026-09-04T13:00:00Z'),
    };

    expect(message.payload).toEqual(['button_reply', 1, { id: 'schedule' }]);
    expect(outbox.payload).toBe(true);
  });
});
