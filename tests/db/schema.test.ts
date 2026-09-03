import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationPath = fileURLToPath(
  new URL('../../apps/server/src/db/migrations/001_initial.sql', import.meta.url),
);

const requiredTables = [
  'users',
  'professionals',
  'services',
  'service_professionals',
  'customers',
  'conversations',
  'messages',
  'appointments',
  'schedule_blocks',
  'inbound_events',
  'outbox_messages',
  'audit_log',
];

function dockerIsAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = dockerIsAvailable();
let containerId: string | undefined;
let pool: Pool | undefined;
let databaseUrl: string | undefined;
let fixtureNumber = 0;

async function waitForDatabase(databaseUrl: string): Promise<Pool> {
  const candidate = new Pool({ connectionString: databaseUrl });
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await candidate.query('select 1');
      return candidate;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await candidate.end();
  throw lastError;
}

async function createSchedulingFixture(): Promise<{ professionalId: string; customerId: string; serviceId: string }> {
  if (!pool) throw new Error('PostgreSQL pool was not initialized');

  fixtureNumber += 1;
  const professional = await pool.query<{ id: string }>(
    "insert into professionals (display_name) values ('Dra. Ana') returning id",
  );
  const customer = await pool.query<{ id: string }>(
    "insert into customers (whatsapp_phone, display_name) values ($1, 'Maria') returning id",
    [`+551199999${String(fixtureNumber).padStart(4, '0')}`],
  );
  const service = await pool.query<{ id: string }>(
    "insert into services (name, base_price_cents, default_duration_minutes, default_before_buffer_minutes, default_after_buffer_minutes) values ('Limpeza', 10000, 60, 15, 15) returning id",
  );

  return {
    professionalId: professional.rows[0].id,
    customerId: customer.rows[0].id,
    serviceId: service.rows[0].id,
  };
}

beforeAll(async () => {
  if (!dockerAvailable) {
    console.warn('Skipping PostgreSQL integration checks: Docker is unavailable. Static migration checks still run.');
    return;
  }

  containerId = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD=test',
      '--env',
      'POSTGRES_USER=test',
      '--env',
      'POSTGRES_DB=test',
      'postgres:16-alpine',
    ],
    { encoding: 'utf8' },
  ).trim();

  const portJson = execFileSync(
    'docker',
    ['inspect', '--format', '{{json .NetworkSettings.Ports}}', containerId],
    { encoding: 'utf8' },
  );
  const port = (JSON.parse(portJson) as Record<string, Array<{ HostPort: string }>>)['5432/tcp'][0].HostPort;
  databaseUrl = `postgres://test:test@127.0.0.1:${port}/test`;
  pool = await waitForDatabase(databaseUrl);
  await pool.query(await readFile(migrationPath, 'utf8'));
}, 20_000);

afterAll(async () => {
  await pool?.end();
  if (containerId) execFileSync('docker', ['rm', '--force', containerId], { stdio: 'ignore' });
});

describe('initial appointment schema', () => {
  it('defines the required PostgreSQL-native tables and scheduling invariants', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    for (const table of requiredTables) {
      expect(sql).toMatch(new RegExp(`create table ${table}`, 'i'));
    }
    expect(sql).toMatch(/price_cents\s+integer\s+null/i);
    expect(sql).toMatch(/duration_minutes\s+integer\s+null/i);
    expect(sql).toMatch(/scheduled_local_date\s+date/i);
    expect(sql).toMatch(/scheduled_local_start_time\s+time/i);
    expect(sql).toMatch(/check \(scheduled_local_date = \(scheduled_start_at at time zone 'America\/Sao_Paulo'\)::date\)/i);
    expect(sql).toMatch(/check \(scheduled_local_start_time = \(scheduled_start_at at time zone 'America\/Sao_Paulo'\)::time\)/i);
    expect(sql).toMatch(/check \(local_date = \(starts_at at time zone 'America\/Sao_Paulo'\)::date\)/i);
    expect(sql).toMatch(/check \(local_start_time = \(starts_at at time zone 'America\/Sao_Paulo'\)::time\)/i);
    expect(sql).toMatch(/check \(local_end_time = \(ends_at at time zone 'America\/Sao_Paulo'\)::time\)/i);
    expect(sql).toMatch(/occupied_range\s+tstzrange\s+generated always as/i);
    expect(sql).toMatch(/exclude using gist[\s\S]*professional_id with =[\s\S]*occupied_range with &&/i);
    expect(sql).toMatch(/status in \('hold', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired'\)/i);
    expect(sql).toMatch(/check \(status <> 'hold' or hold_expires_at is not null\)/i);
    expect(sql).toMatch(/conversation.*ordering/i);
    expect(sql).toMatch(/outbox.*delivery/i);
    expect(sql).toMatch(/outbox.*reminder/i);
  });

  it.runIf(dockerAvailable)('rejects an active hold without an expiry', async () => {
    if (!pool) throw new Error('PostgreSQL pool was not initialized');
    const fixture = await createSchedulingFixture();

    await expect(
      pool.query(
        `insert into appointments (
          professional_id, customer_id, service_id, status, scheduled_start_at, scheduled_end_at,
          scheduled_local_date, scheduled_local_start_time, price_cents, duration_minutes,
          before_buffer_minutes, after_buffer_minutes
        ) values ($1, $2, $3, 'hold', '2026-09-04T13:00:00Z', '2026-09-04T14:00:00Z', '2026-09-04', '10:00', 10000, 60, 15, 15)`,
        [fixture.professionalId, fixture.customerId, fixture.serviceId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.runIf(dockerAvailable)('creates active appointment ranges that cannot overlap', async () => {
    if (!pool) throw new Error('PostgreSQL pool was not initialized');
    const fixture = await createSchedulingFixture();

    await pool.query(
      `insert into appointments (
        professional_id, customer_id, service_id, status, scheduled_start_at, scheduled_end_at,
        scheduled_local_date, scheduled_local_start_time, price_cents, duration_minutes,
        before_buffer_minutes, after_buffer_minutes, hold_expires_at
      ) values ($1, $2, $3, 'hold', '2026-09-04T13:00:00Z', '2026-09-04T14:00:00Z', '2026-09-04', '10:00', 10000, 60, 15, 15, '2026-09-04T12:45:00Z')`,
      [fixture.professionalId, fixture.customerId, fixture.serviceId],
    );

    await expect(
      pool.query(
        `insert into appointments (
          professional_id, customer_id, service_id, status, scheduled_start_at, scheduled_end_at,
          scheduled_local_date, scheduled_local_start_time, price_cents, duration_minutes,
          before_buffer_minutes, after_buffer_minutes
        ) values ($1, $2, $3, 'confirmed', '2026-09-04T14:10:00Z', '2026-09-04T15:10:00Z', '2026-09-04', '11:10', 10000, 60, 0, 0)`,
        [fixture.professionalId, fixture.customerId, fixture.serviceId],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it.runIf(dockerAvailable)('rejects appointment local fields that diverge from Sao Paulo instants', async () => {
    if (!pool) throw new Error('PostgreSQL pool was not initialized');
    const fixture = await createSchedulingFixture();

    await expect(
      pool.query(
        `insert into appointments (
          professional_id, customer_id, service_id, status, scheduled_start_at, scheduled_end_at,
          scheduled_local_date, scheduled_local_start_time, price_cents, duration_minutes,
          before_buffer_minutes, after_buffer_minutes
        ) values ($1, $2, $3, 'confirmed', '2026-09-04T16:00:00Z', '2026-09-04T17:00:00Z', '2026-09-04', '10:00', 10000, 60, 0, 0)`,
        [fixture.professionalId, fixture.customerId, fixture.serviceId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.runIf(dockerAvailable)('rejects schedule block local fields that diverge from Sao Paulo instants', async () => {
    if (!pool) throw new Error('PostgreSQL pool was not initialized');
    const fixture = await createSchedulingFixture();

    await expect(
      pool.query(
        `insert into schedule_blocks (
          professional_id, starts_at, ends_at, local_date, local_start_time, local_end_time
        ) values ($1, '2026-09-04T16:00:00Z', '2026-09-04T17:00:00Z', '2026-09-04', '10:00', '14:00')`,
        [fixture.professionalId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.runIf(dockerAvailable)('provides the migrated tables through a Kysely client', async () => {
    if (!databaseUrl) throw new Error('PostgreSQL URL was not initialized');

    const clientModule = import('../../apps/server/src/db/client.js');
    await expect(clientModule).resolves.toMatchObject({ createDatabase: expect.any(Function) });
    const { createDatabase } = await clientModule;
    const db = createDatabase(databaseUrl);
    const appointments = await db.selectFrom('appointments').select('id').execute();

    expect(appointments).toHaveLength(1);
    await db.destroy();
  });
});
