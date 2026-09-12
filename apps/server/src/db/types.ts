import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
type Json = ColumnType<JsonValue, JsonValue, JsonValue>;

export type AppointmentStatus = 'hold' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'expired';
export type MessageDirection = 'inbound' | 'outbound';
export type OutboxStatus = 'pending' | 'retrying' | 'sent' | 'delivered' | 'failed' | 'cancelled';
export type ReminderKind = '24h' | '3h';

interface Timestamped {
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UsersTable extends Timestamped {
  id: Generated<string>;
  email: string;
  display_name: string;
  role: 'admin' | 'staff';
  active: Generated<boolean>;
}

export interface ProfessionalsTable extends Timestamped {
  id: Generated<string>;
  user_id: string | null;
  display_name: string;
  timezone: Generated<string>;
  active: Generated<boolean>;
}

export interface ServicesTable extends Timestamped {
  id: Generated<string>;
  name: string;
  description: string | null;
  base_price_cents: number;
  default_duration_minutes: number;
  default_before_buffer_minutes: Generated<number>;
  default_after_buffer_minutes: Generated<number>;
  active: Generated<boolean>;
}

export interface ServiceProfessionalsTable extends Timestamped {
  service_id: string;
  professional_id: string;
  price_cents: number | null;
  duration_minutes: number | null;
  before_buffer_minutes: number | null;
  after_buffer_minutes: number | null;
  active: Generated<boolean>;
}

export interface CustomersTable extends Timestamped {
  id: Generated<string>;
  whatsapp_phone: string;
  display_name: string | null;
  locale: Generated<string>;
  consent_data_at: Timestamp | null;
  consent_marketing_at: Timestamp | null;
  marketing_opted_out_at: Timestamp | null;
}

export interface ConversationsTable extends Timestamped {
  id: Generated<string>;
  customer_id: string;
  status: Generated<'open' | 'closed'>;
  ai_paused_at: Timestamp | null;
  human_owner_user_id: string | null;
  last_message_at: Timestamp | null;
  last_inbound_at: Timestamp | null;
  summary: string | null;
}

export interface MessagesTable {
  id: Generated<string>;
  conversation_id: string;
  provider_message_id: string | null;
  direction: MessageDirection;
  message_type: string;
  body: string | null;
  payload: Json;
  occurred_at: Timestamp;
  created_at: Generated<Timestamp>;
  media_transcription_status: 'pending' | 'completed' | 'failed' | 'rejected' | null;
  media_transcription_text: string | null;
  media_transcription_error: string | null;
}

export interface AppointmentsTable extends Timestamped {
  id: Generated<string>;
  professional_id: string;
  customer_id: string;
  service_id: string;
  conversation_id: string | null;
  status: AppointmentStatus;
  scheduled_start_at: Timestamp;
  scheduled_end_at: Timestamp;
  scheduled_local_date: string;
  scheduled_local_start_time: string;
  timezone: Generated<string>;
  price_cents: number;
  duration_minutes: number;
  before_buffer_minutes: number;
  after_buffer_minutes: number;
  occupied_range: Generated<string>;
  hold_expires_at: Timestamp | null;
  confirmed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  cancellation_reason: string | null;
}

export interface ScheduleBlocksTable extends Timestamped {
  id: Generated<string>;
  professional_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  local_date: string;
  local_start_time: string;
  local_end_time: string;
  timezone: Generated<string>;
  reason: string | null;
}
export interface WorkingHoursTable extends Timestamped {
  id: Generated<string>;
  professional_id: string;
  weekday: number;
  starts_at_local: string;
  ends_at_local: string;
  active: Generated<boolean>;
}

export interface InboundEventsTable {
  id: Generated<string>;
  provider_event_id: string;
  received_at: Generated<Timestamp>;
  payload: Json;
  processed_at: Timestamp | null;
  processing_error: string | null;
}

export interface OutboxMessagesTable extends Timestamped {
  id: Generated<string>;
  conversation_id: string | null;
  customer_id: string;
  appointment_id: string | null;
  reminder_kind: ReminderKind | null;
  status: Generated<OutboxStatus>;
  payload: Json;
  provider_message_id: string | null;
  delivery_due_at: Timestamp;
  reminder_due_at: Timestamp | null;
  delivered_at: Timestamp | null;
  attempts: Generated<number>;
  last_error: string | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_user_id: string | null;
  customer_id: string | null;
  appointment_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Json | null;
  after: Json | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  users: UsersTable;
  professionals: ProfessionalsTable;
  services: ServicesTable;
  service_professionals: ServiceProfessionalsTable;
  customers: CustomersTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
  appointments: AppointmentsTable;
  schedule_blocks: ScheduleBlocksTable;
  working_hours: WorkingHoursTable;
  inbound_events: InboundEventsTable;
  outbox_messages: OutboxMessagesTable;
  audit_log: AuditLogTable;
}
