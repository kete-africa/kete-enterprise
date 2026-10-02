import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type pg from 'pg';

/**
 * Personal links (spec 010): what a person without an account may open, with row-level security in
 * the same migration. The table keeps a SHA-256 fingerprint, never the link. A link carries no
 * organization: a definer function finds it from the fingerprint alone, and nothing else.
 */
export function passesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.person_passes (
  pass_id text primary key,
  organization_id text not null,
  person_id text not null,
  purpose text not null check (purpose ~ '^[a-z]+\\.[a-z_]+$'),
  reference text not null check (length(reference) between 1 and 80),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id)
);
create index person_passes_subject on ${s}.person_passes (organization_id, person_id, purpose, reference);
${organizationPolicySql({ schema: s, table: 'person_passes', appRole: options.appRole })}
grant select, insert, update on ${s}.person_passes to ${options.appRole};

create function ${s}.pass_by_fingerprint(candidate text)
  returns table (organization_id text, pass_id text, person_id text, purpose text, reference text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, pass_id, person_id, purpose, reference from person_passes
         where fingerprint = candidate and revoked_at is null and expires_at > now() $$;
revoke all on function ${s}.pass_by_fingerprint(text) from public;
grant execute on function ${s}.pass_by_fingerprint(text) to ${options.appRole};
`;
}

export interface PassRow {
  organizationId: string;
  passId: string;
  personId: string;
  purpose: string;
  reference: string;
}

export async function insertPass(
  db: SqlExecutor,
  organizationId: string,
  input: {
    personId: string;
    purpose: string;
    reference: string;
    fingerprint: string;
    expiresAt: Date;
  },
): Promise<string> {
  // A new link for the same person and purpose replaces the previous one.
  await db.query(
    `update person_passes set revoked_at = now()
      where person_id = $1 and purpose = $2 and reference = $3 and revoked_at is null`,
    [input.personId, input.purpose, input.reference],
  );
  const passId = newId('pss');
  await db.query(
    `insert into person_passes (pass_id, organization_id, person_id, purpose, reference, fingerprint,
       expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      passId,
      organizationId,
      input.personId,
      input.purpose,
      input.reference,
      input.fingerprint,
      input.expiresAt,
    ],
  );
  return passId;
}

export async function revokeFor(
  db: SqlExecutor,
  purpose: string,
  reference: string,
): Promise<number> {
  const { rows } = await db.query(
    `update person_passes set revoked_at = now()
      where purpose = $1 and reference = $2 and revoked_at is null
      returning pass_id`,
    [purpose, reference],
  );
  return rows.length;
}

/** The live link behind a fingerprint, whatever its organization; null otherwise. */
export async function passByFingerprint(
  pool: pg.Pool,
  fingerprint: string,
): Promise<PassRow | null> {
  const { rows } = await pool.query<{
    organization_id: string;
    pass_id: string;
    person_id: string;
    purpose: string;
    reference: string;
  }>(
    `select organization_id, pass_id, person_id, purpose, reference
       from pass_by_fingerprint($1)`,
    [fingerprint],
  );
  const row = rows[0];
  return row
    ? {
        organizationId: row.organization_id,
        passId: row.pass_id,
        personId: row.person_id,
        purpose: row.purpose,
        reference: row.reference,
      }
    : null;
}

export async function touchPass(db: SqlExecutor, passId: string): Promise<void> {
  await db.query(`update person_passes set last_used_at = now() where pass_id = $1`, [passId]);
}
