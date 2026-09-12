create table working_hours (
  id uuid primary key default gen_random_uuid(), professional_id uuid not null references professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), starts_at_local time not null, ends_at_local time not null,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_at_local > starts_at_local), unique (professional_id, weekday, starts_at_local, ends_at_local)
);
create index working_hours_lookup_idx on working_hours (professional_id, weekday) where active;
