import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './types.js';

export type DatabaseClient = Kysely<Database>;

/** Creates a typed PostgreSQL client. Call `destroy()` during process shutdown. */
export function createDatabase(databaseUrl: string): DatabaseClient {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl }),
    }),
  });
}
