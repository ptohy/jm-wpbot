ALTER TABLE outbox_messages
  ADD COLUMN IF NOT EXISTS hub_intent_id uuid,
  ADD COLUMN IF NOT EXISTS hub_delivery_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS hub_delivery_error text;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_messages_hub_intent_unique
  ON outbox_messages(hub_intent_id)
  WHERE hub_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_messages_hub_delivery_pending_idx
  ON outbox_messages(status, hub_delivery_reported_at)
  WHERE hub_intent_id IS NOT NULL
    AND hub_delivery_reported_at IS NULL;
