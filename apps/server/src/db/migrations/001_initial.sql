create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- PostgreSQL marks timestamptz + interval as STABLE because intervals can
-- contain calendar units. This helper only accepts minute offsets, so its
-- result is independent of the session time zone and can safely back a
-- generated range column.
create function add_utc_minutes(instant timestamptz, minutes integer)
returns timestamptz
language sql
immutable
strict
parallel safe
return instant + make_interval(mins => minutes);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table professionals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references users(id) on delete set null,
  display_name text not null,
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  base_price_cents integer not null check (base_price_cents >= 0),
  default_duration_minutes integer not null check (default_duration_minutes > 0),
  default_before_buffer_minutes integer not null default 0 check (default_before_buffer_minutes >= 0),
  default_after_buffer_minutes integer not null default 0 check (default_after_buffer_minutes >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table service_professionals (
  service_id uuid not null references services(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  price_cents integer null check (price_cents >= 0),
  duration_minutes integer null check (duration_minutes > 0),
  before_buffer_minutes integer null check (before_buffer_minutes >= 0),
  after_buffer_minutes integer null check (after_buffer_minutes >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_id, professional_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  whatsapp_phone text not null unique,
  display_name text,
  locale text not null default 'pt-BR',
  consent_data_at timestamptz,
  consent_marketing_at timestamptz,
  marketing_opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed')),
  ai_paused_at timestamptz,
  human_owner_user_id uuid references users(id) on delete set null,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_ordering_idx on conversations (status, last_message_at desc nulls last, id desc);
create unique index conversations_one_open_per_customer_idx on conversations (customer_id) where status = 'open';

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  provider_message_id text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_ordering_idx on messages (conversation_id, occurred_at, id);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  service_id uuid not null references services(id) on delete restrict,
  conversation_id uuid references conversations(id) on delete set null,
  status text not null check (status in ('hold', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired')),
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  scheduled_local_date date not null,
  scheduled_local_start_time time not null,
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  before_buffer_minutes integer not null default 0 check (before_buffer_minutes >= 0),
  after_buffer_minutes integer not null default 0 check (after_buffer_minutes >= 0),
  occupied_range tstzrange generated always as (
    tstzrange(
      add_utc_minutes(scheduled_start_at, -before_buffer_minutes),
      add_utc_minutes(scheduled_end_at, after_buffer_minutes),
      '[)'
    )
  ) stored,
  hold_expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end_at > scheduled_start_at),
  check (scheduled_local_date = (scheduled_start_at at time zone 'America/Sao_Paulo')::date),
  check (scheduled_local_start_time = (scheduled_start_at at time zone 'America/Sao_Paulo')::time),
  check (status <> 'hold' or hold_expires_at is not null),
  exclude using gist (
    professional_id with =,
    occupied_range with &&
  ) where (status in ('hold', 'confirmed'))
);

create index appointments_customer_start_idx on appointments (customer_id, scheduled_start_at desc);
create index appointments_hold_expiry_idx on appointments (hold_expires_at) where status = 'hold';

create table schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  local_date date not null,
  local_start_time time not null,
  local_end_time time not null,
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (local_date = (starts_at at time zone 'America/Sao_Paulo')::date),
  check (local_start_time = (starts_at at time zone 'America/Sao_Paulo')::time),
  check (local_end_time = (ends_at at time zone 'America/Sao_Paulo')::time)
);

create index schedule_blocks_professional_range_idx on schedule_blocks (professional_id, starts_at, ends_at);

create table inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text
);

create index inbound_events_unprocessed_idx on inbound_events (received_at) where processed_at is null;

create table outbox_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  customer_id uuid not null references customers(id) on delete restrict,
  appointment_id uuid references appointments(id) on delete set null,
  reminder_kind text check (reminder_kind in ('24h', '3h')),
  status text not null default 'pending' check (status in ('pending', 'retrying', 'sent', 'delivered', 'failed', 'cancelled')),
  payload jsonb not null,
  provider_message_id text unique,
  delivery_due_at timestamptz not null default now(),
  reminder_due_at timestamptz,
  delivered_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbox_messages_delivery_due_idx on outbox_messages (delivery_due_at, id)
  where status in ('pending', 'retrying');
create index outbox_messages_reminder_due_idx on outbox_messages (reminder_due_at, id)
  where reminder_due_at is not null and status in ('pending', 'retrying');

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity_type, entity_id, created_at desc);
