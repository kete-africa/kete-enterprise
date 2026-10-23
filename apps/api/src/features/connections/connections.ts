import { defineCommand } from '@kete/commands';
import { allows, grantsOf, newWebhookSecret, type ConnectionGrants } from '@kete/connections';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { open, seal, secretsOn } from '../../platform/secrets.js';
import { listConnectors } from '../connectors/index.js';
import { listToolSets } from '../tools/index.js';

// One connection, three uses (spec 105; doctrine D-062, R8, R17; kete-core ADR 0019 and spec 147):
// an organization's tool — its ERP, its CRM — reached once, and seen once, with what it serves:
// read (Kete and the boards), act (its agents, tool by tool, at a level, as drafts), signal (what
// waits, into « Décider »). Its health says « à reconnecter » where it fails. Its events arrive by a
// webhook signed with a secret of its own, onto the one event path (spec 101).

export function connectionsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
-- What an imported set may do: read when connected; act only tool by tool. The sets imported
-- before keep what they did — their act tools as drafts.
alter table ${s}.imported_tool_sets add column grants jsonb;
update ${s}.imported_tool_sets set grants = jsonb_build_object(
  'read', true,
  'act', coalesce((select jsonb_object_agg(t->>'name', 3) from jsonb_array_elements(tools) t
                    where t->>'effect' in ('act', 'destroy')), '{}'::jsonb),
  'signal', '[]'::jsonb);
alter table ${s}.imported_tool_sets alter column grants set not null,
  alter column grants set default '{"read": true, "act": {}, "signal": []}'::jsonb;

-- The secret a connection's webhook is signed with, sealed; one per connection.
create table ${s}.connection_webhooks (
  organization_id text not null,
  connection_id text not null check (connection_id ~ '^(tls|cnr)_[0-9a-f-]{8,64}$'),
  secret_sealed text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, connection_id)
);
${organizationPolicySql({ schema: s, table: 'connection_webhooks', appRole: options.appRole })}
grant select, insert, update on ${s}.connection_webhooks to ${options.appRole};

-- The webhook reaches the API without a person: it finds its organization by the connection.
create function ${s}.connection_webhook_of(id text)
  returns table (organization_id text, secret_sealed text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, secret_sealed from connection_webhooks where connection_id = id $$;
revoke all on function ${s}.connection_webhook_of(text) from public;
grant execute on function ${s}.connection_webhook_of(text) to ${options.appRole};

alter table ${s}.kete_events drop constraint kete_events_source_check;
alter table ${s}.kete_events add constraint kete_events_source_check
  check (source in ('app', 'index', 'measure', 'connection'));
`;
}

export type Health = 'ok' | 'reconnect' | 'off' | 'trial';

export interface ConnectionView {
  /** The set's or the connector's id: one row of the past, one use. */
  connectionId: string;
  label: string;
  address: string;
  adapter: 'mcp' | 'openapi';
  uses: {
    read: boolean;
    act: { tool: string; description: string; level: number | null }[];
    signal: string[];
  };
  health: Health;
  lastError: string | null;
  webhook: boolean;
}

/** Every connection of the organization, one per address, each with its three uses and health. */
export async function connectionsOf(db: SqlExecutor): Promise<ConnectionView[]> {
  const sets = await listToolSets(db);
  const connectors = await listConnectors(db);
  const { rows: hooks } = await db.query<{ connection_id: string }>(
    `select connection_id from connection_webhooks`,
  );
  const { rows: grantRows } = await db.query<{ set_id: string; grants: unknown }>(
    `select set_id, grants from imported_tool_sets`,
  );
  const grantsBy = new Map(grantRows.map((r) => [r.set_id, grantsOf(r.grants)]));
  const hooked = new Set(hooks.map((h) => h.connection_id));
  const views: ConnectionView[] = sets.map((set) => {
    const grants = grantsBy.get(set.setId) ?? grantsOf(null);
    return {
      connectionId: set.setId,
      label: set.label,
      address: set.address,
      adapter: set.kind,
      uses: {
        read: grants.read,
        act: set.tools
          .filter((t) => t.effect !== 'read')
          .map((t) => {
            const allowed = allows(grants, 'act', t.name);
            return {
              tool: t.name,
              description: t.description,
              level: allowed.allowed ? allowed.level : null,
            };
          }),
        signal: [],
      },
      health: set.status === 'off' ? 'off' : 'ok',
      lastError: null,
      webhook: hooked.has(set.setId),
    };
  });
  for (const connector of connectors) {
    // A connector on an address a set already reaches is the same connection: one more use.
    const same = views.find((v) => v.address === connector.address);
    const health: Health =
      connector.status === 'off'
        ? 'off'
        : connector.status === 'trial'
          ? 'trial'
          : connector.lastError
            ? 'reconnect'
            : 'ok';
    if (same) {
      same.uses.signal.push(connector.reading.tool);
      if (health === 'reconnect') {
        same.health = 'reconnect';
        same.lastError = connector.lastError;
      }
      continue;
    }
    views.push({
      connectionId: connector.connectorId,
      label: connector.name,
      address: connector.address,
      adapter: 'mcp',
      uses: { read: false, act: [], signal: [connector.reading.tool] },
      health,
      lastError: connector.lastError,
      webhook: hooked.has(connector.connectorId),
    });
  }
  return views;
}

export class ConnectionRefusal extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid' | 'no_secrets',
    message: string,
  ) {
    super(message);
  }
}

/** What a set may do: read or not, each act tool at a level — never above « prepare ». */
export const setConnectionGrants = defineCommand({
  name: 'set-connection-grants',
  input: z.object({
    connectionId: z.string().regex(/^tls_[0-9a-f-]{8,64}$/),
    read: z.boolean(),
    act: z.record(z.string().min(1).max(120), z.union([z.literal(1), z.literal(2), z.literal(3)])),
  }),
  reversibility: { reversible: true, inverse: 'set-connection-grants' },
  async handler(input, { db }) {
    const set = (await listToolSets(db)).find((s) => s.setId === input.connectionId);
    if (!set) throw new ConnectionRefusal('not_found', 'No such connection.');
    const acting = new Set(set.tools.filter((t) => t.effect !== 'read').map((t) => t.name));
    const unknown = Object.keys(input.act).filter((tool) => !acting.has(tool));
    if (unknown.length) {
      throw new ConnectionRefusal('invalid', `Not an act tool of it: ${unknown.join(', ')}`);
    }
    const { rows } = await db.query<{ grants: unknown }>(
      `select grants from imported_tool_sets where set_id = $1`,
      [input.connectionId],
    );
    const before = grantsOf(rows[0]?.grants);
    const grants: ConnectionGrants = { read: input.read, act: input.act, signal: before.signal };
    await db.query(
      `update imported_tool_sets set grants = $2, changed_at = now() where set_id = $1`,
      [input.connectionId, JSON.stringify(grants)],
    );
    return { connectionId: input.connectionId, before, grants };
  },
  summarize: (input) => `Connection ${input.connectionId}: its uses changed`,
});

/**
 * A webhook for a connection: its new secret, sealed by the caller — the journal keeps that it was
 * made and the sealed form, never the secret, which is said once to the administrator.
 */
export const openWebhook = defineCommand({
  name: 'open-connection-webhook',
  input: z.object({
    connectionId: z.string().regex(/^(tls|cnr)_[0-9a-f-]{8,64}$/),
    sealed: z.string().min(20).max(400),
    by: z.string().min(1).max(128),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const known = (await connectionsOf(db)).some((c) => c.connectionId === input.connectionId);
    if (!known) throw new ConnectionRefusal('not_found', 'No such connection.');
    await db.query(
      `insert into connection_webhooks (organization_id, connection_id, secret_sealed, created_by)
       values ($1, $2, $3, $4)
       on conflict (organization_id, connection_id) do update
         set secret_sealed = excluded.secret_sealed, created_by = excluded.created_by,
             created_at = now()`,
      [organizationId, input.connectionId, input.sealed, input.by],
    );
    return { connectionId: input.connectionId };
  },
  summarize: (input) => `Webhook of ${input.connectionId} opened`,
});

/** A new webhook secret and its sealed form; none where secrets cannot be kept. */
export function webhookSecret(): { secret: string; sealed: string } | null {
  if (!secretsOn()) return null;
  const secret = newWebhookSecret();
  return { secret, sealed: seal(secret) };
}

/** The secret a webhook is checked against, and its organization; null when it has none. */
export async function webhookOf(
  db: SqlExecutor,
  connectionId: string,
): Promise<{ organizationId: string; secret: string } | null> {
  const { rows } = await db.query<{ organization_id: string; secret_sealed: string }>(
    'select organization_id, secret_sealed from connection_webhook_of($1)',
    [connectionId],
  );
  const row = rows[0];
  const secret = row ? open(row.secret_sealed) : null;
  return row && secret ? { organizationId: row.organization_id, secret } : null;
}
