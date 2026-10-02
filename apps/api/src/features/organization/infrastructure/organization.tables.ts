import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import {
  moduleKeys,
  onByDefault,
  type ModuleKey,
  type Modules,
  type OrganizationSettings,
} from '../organization.record.js';

/**
 * The organization's modules and settings, with row-level security in the same migration. The
 * application reads the settings but never writes them: whether an organization is a demo is the
 * instance operator's decision (spec 010), taken with the owner role.
 */
export function organizationMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.organization_modules (
  organization_id text not null,
  module text not null check (module ~ '^[a-z]+$'),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, module)
);
${policy('organization_modules')}
grant select, insert, update on ${s}.organization_modules to ${options.appRole};

create table ${s}.organization_settings (
  organization_id text primary key,
  demo boolean not null default false,
  updated_at timestamptz not null default now()
);
${policy('organization_settings')}
revoke all on ${s}.organization_settings from ${options.appRole};
grant select on ${s}.organization_settings to ${options.appRole};
`;
}

export async function readModules(db: SqlExecutor): Promise<Modules> {
  const { rows } = await db.query<{ module: string; enabled: boolean }>(
    `select module, enabled from organization_modules`,
  );
  const modules = { ...onByDefault };
  for (const row of rows) {
    if ((moduleKeys as readonly string[]).includes(row.module)) {
      modules[row.module as ModuleKey] = row.enabled;
    }
  }
  return modules;
}

export async function writeModule(
  db: SqlExecutor,
  organizationId: string,
  module: ModuleKey,
  enabled: boolean,
): Promise<void> {
  await db.query(
    `insert into organization_modules (organization_id, module, enabled) values ($1, $2, $3)
     on conflict (organization_id, module) do update set enabled = $3, updated_at = now()`,
    [organizationId, module, enabled],
  );
}

export async function readSettings(db: SqlExecutor): Promise<OrganizationSettings> {
  const { rows } = await db.query<{ demo: boolean }>(
    `select demo from organization_settings limit 1`,
  );
  return { demo: rows[0]?.demo ?? false };
}
