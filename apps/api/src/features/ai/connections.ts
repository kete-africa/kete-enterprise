import type { ModelConfig } from '@kete/ai';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { open, seal } from '../../platform/secrets.js';

// Each person's own AI connection (spec 026): whoever wants her assistant and her agents to run on
// her own tokens brings her key. The organization says whether it allows it, requires it, or pays
// for everyone. A key is sealed at rest, never returned, never sent anywhere but its provider.

export function aiConnectionsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.ai_connections (
  organization_id text not null,
  user_id text not null,
  provider text not null check (provider in ('openai', 'anthropic', 'mistral', 'deepseek')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$'),
  sealed_key text not null,
  key_end text not null check (length(key_end) = 4),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  primary key (organization_id, user_id)
);
${policy('ai_connections')}
grant select, insert, update, delete on ${s}.ai_connections to ${options.appRole};

create table ${s}.ai_settings (
  organization_id text primary key,
  personal text not null default 'allowed' check (personal in ('off', 'allowed', 'required'))
);
${policy('ai_settings')}
grant select, insert, update on ${s}.ai_settings to ${options.appRole};
`;
}

export const personalProviders = ['openai', 'anthropic', 'mistral', 'deepseek'] as const;
export type PersonalProvider = (typeof personalProviders)[number];

/**
 * off: the organization's model only; allowed: her own key when she brought one, the
 * organization's otherwise; required: her own key only — the organization pays for nobody.
 */
export type PersonalPolicy = 'off' | 'allowed' | 'required';

export const connectionInput = z.object({
  provider: z.enum(personalProviders),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/),
  apiKey: z.string().trim().min(20).max(400),
});

export interface Connection {
  provider: PersonalProvider;
  model: string;
  /** The last four characters of the key: enough to recognize it, never to use it. */
  keyEnd: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function readPolicy(db: SqlExecutor): Promise<PersonalPolicy> {
  const { rows } = await db.query<{ personal: PersonalPolicy }>(
    `select personal from ai_settings limit 1`,
  );
  return rows[0]?.personal ?? 'allowed';
}

export async function setPolicy(
  db: SqlExecutor,
  organizationId: string,
  personal: PersonalPolicy,
): Promise<void> {
  await db.query(
    `insert into ai_settings (organization_id, personal) values ($1, $2)
     on conflict (organization_id) do update set personal = $2`,
    [organizationId, personal],
  );
}

export async function readConnection(db: SqlExecutor, userId: string): Promise<Connection | null> {
  const { rows } = await db.query<{
    provider: PersonalProvider;
    model: string;
    key_end: string;
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `select provider, model, key_end, created_at, last_used_at from ai_connections
      where user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r
    ? {
        provider: r.provider,
        model: r.model,
        keyEnd: r.key_end,
        createdAt: r.created_at.toISOString(),
        lastUsedAt: r.last_used_at?.toISOString() ?? null,
      }
    : null;
}

export async function saveConnection(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  input: z.infer<typeof connectionInput>,
): Promise<void> {
  await db.query(
    `insert into ai_connections (organization_id, user_id, provider, model, sealed_key, key_end)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, user_id) do update
       set provider = $3, model = $4, sealed_key = $5, key_end = $6, created_at = now(),
           last_used_at = null`,
    [
      organizationId,
      userId,
      input.provider,
      input.model,
      seal(input.apiKey),
      input.apiKey.slice(-4),
    ],
  );
}

export async function removeConnection(db: SqlExecutor, userId: string): Promise<void> {
  await db.query(`delete from ai_connections where user_id = $1`, [userId]);
}

/** Which model answers this person, and who pays: her own key, or the organization. */
export type ModelChoice = { config: ModelConfig; personal: boolean } | null;

/**
 * The model of a person's assistant and agents, by the organization's policy: her own connection
 * when allowed and present (its last use noted), else the organization's model — unless the
 * policy requires her own, then none. When she chooses the organization (spec 026b), her key is
 * left aside — if the policy lets the organization pay.
 */
export async function modelChoiceFor(
  db: SqlExecutor,
  userId: string,
  organizationModel: ModelConfig | null,
  prefer?: 'organization' | 'key',
): Promise<ModelChoice> {
  const policy = await readPolicy(db);
  if (policy !== 'off' && !(prefer === 'organization' && policy === 'allowed')) {
    const { rows } = await db.query<{
      provider: PersonalProvider;
      model: string;
      sealed_key: string;
    }>(
      `update ai_connections set last_used_at = now() where user_id = $1
       returning provider, model, sealed_key`,
      [userId],
    );
    const own = rows[0];
    const apiKey = own ? open(own.sealed_key) : null;
    if (own && apiKey) {
      return { config: { provider: own.provider, model: own.model, apiKey }, personal: true };
    }
  }
  if (policy === 'required') return null;
  return organizationModel ? { config: organizationModel, personal: false } : null;
}
