import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';

const MIGRATION_LOCK = 94721031;
const migrationsDir = fileURLToPath(new URL('./migrations/', import.meta.url));

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query<{ relation: string | null }>(
    'select to_regclass($1) as relation',
    [`public.${name}`],
  );
  return Boolean(result.rows[0]?.relation);
}

async function indexExists(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query<{ relation: string | null }>(
    'select to_regclass($1) as relation',
    [`public.${name}`],
  );
  return Boolean(result.rows[0]?.relation);
}

async function columnExists(
  client: PoolClient,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await client.query<{ found: boolean }>(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
     ) as found`,
    [table, column],
  );
  return result.rows[0]?.found === true;
}

async function bootstrapLegacyState(client: PoolClient): Promise<void> {
  const applied = async (name: string) => {
    await client.query(
      'insert into schema_migrations (name) values ($1) on conflict do nothing',
      [name],
    );
  };

  if (await tableExists(client, 'users')) {
    await applied('001_initial.sql');
  }
  if (await indexExists(client, 'outbox_messages_appointment_reminder_kind_uidx')) {
    await applied('002_reminder_idempotency.sql');
  }
  if (await tableExists(client, 'working_hours')) {
    await applied('002_working_hours.sql');
  }
  if (await columnExists(client, 'messages', 'media_transcription_status')) {
    await applied('003_media_transcription.sql');
  }
  if (await columnExists(client, 'outbox_messages', 'hub_intent_id')) {
    await applied('004_hub_intent_delivery.sql');
  }
}

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await bootstrapLegacyState(client);

    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();

    const existing = await client.query<{ name: string }>(
      'select name from schema_migrations order by name',
    );
    const applied = new Set(existing.rows.map((row) => row.name));

    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into schema_migrations (name) values ($1)',
          [name],
        );
        await client.query('commit');
        appliedNow.push(name);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    return appliedNow;
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const applied = await runMigrations(databaseUrl);
  console.log(JSON.stringify({ migrations: 'ok', applied }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
