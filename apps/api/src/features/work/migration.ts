import { workMigrationSql } from '@kete/work';

/**
 * The holdings (kete-core `@kete/work`, with their RLS in the same migration), and the list of
 * organizations the worker's relay goes through: one row per organization with people, read
 * across organizations by a function of the owner, never the rows themselves.
 */
export function holdingsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `${workMigrationSql(options)}
create function ${s}.work_organizations() returns table (organization_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select distinct organization_id from people $$;
revoke all on function ${s}.work_organizations() from public;
grant execute on function ${s}.work_organizations() to ${options.appRole};
`;
}
