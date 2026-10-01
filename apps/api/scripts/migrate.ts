import pg from 'pg';
import { migrations } from '../db/migrations.js';

// Applies the pending migrations with the owner role, before each deployment (docs/OPERATIONS.md).
const ownerUrl = process.env.OWNER_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error('OWNER_DATABASE_URL and DATABASE_URL must be set.');

const context = {
  schema: 'public',
  ownerRole: decodeURIComponent(new URL(ownerUrl).username),
  appRole: decodeURIComponent(new URL(appUrl).username),
};
const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
try {
  await owner.query(
    `create table if not exists kete_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const { rows } = await owner.query<{ name: string }>('select name from kete_migrations');
  const applied = new Set(rows.map((row) => row.name));
  for (const migration of migrations.filter((m) => !applied.has(m.name))) {
    const client = await owner.connect();
    try {
      await client.query('begin');
      await client.query(migration.sql(context));
      await client.query('insert into kete_migrations (name) values ($1)', [migration.name]);
      await client.query('commit');
      console.log(`[migrate] ${migration.name}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await owner.end();
}
