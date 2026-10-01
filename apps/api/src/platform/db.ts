import { inOrganization, type SqlExecutor } from '@kete/tenancy';
import pg from 'pg';
import { env } from './env.js';

let pool: pg.Pool | undefined;

/** The application role's pool: row-level security applies to every query. */
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
  return pool;
}

/** Tests: run the API on another pool (a test schema). */
export function usePool(next: pg.Pool): void {
  pool = next;
}

/** Runs `work` in a transaction of the organization: it sees that organization's rows only. */
export function transaction<T>(
  organizationId: string,
  work: (db: SqlExecutor) => Promise<T>,
): Promise<T> {
  return inOrganization(getPool(), organizationId, work);
}
