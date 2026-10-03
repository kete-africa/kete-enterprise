import type { KeteIdentity } from '@kete/auth';
import { validateEvent, type KeteEvent } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { listResources, registryFor } from '../registry/index.js';
import { appGrants } from './app-permissions.js';

// The apps' business events (spec 025, kete-core spec 049): an app announces what happened —
// identifiers and facts only — with its own token; Kete Enterprise keeps each event once, for the
// organization whose registry holds the app, and tells its people in their morning briefing.

export function appEventsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.app_events (
  event_id text primary key,
  organization_id text not null,
  product text not null,
  resource_id text not null,
  type text not null,
  description text not null,
  classification text not null default 'internal'
    check (classification in ('public', 'internal', 'confidential', 'secret')),
  occurred_at timestamptz not null,
  data jsonb not null,
  received_at timestamptz not null default now()
);
create index app_events_recent on ${s}.app_events (organization_id, occurred_at desc);
${organizationPolicySql({ schema: s, table: 'app_events', appRole: options.appRole })}
grant select, insert on ${s}.app_events to ${options.appRole};
`;
}

export type EventOutcome =
  | { id: string; outcome: 'accepted' | 'duplicate' }
  | { id: string; outcome: 'refused'; reason: string };

/**
 * Keeps one event of an app, in its organization's transaction: only from the app the registry
 * holds under that client id and product, and only a type its card declares (`emits`).
 */
export async function receiveAppEvent(
  db: SqlExecutor,
  clientId: string,
  event: unknown,
): Promise<EventOutcome> {
  const id = (event as { id?: unknown } | null)?.id;
  const eventId = typeof id === 'string' ? id : '';
  if (!validateEvent(event).ok) return { id: eventId, outcome: 'refused', reason: 'invalid' };
  const e = event as KeteEvent;
  const app = (await listResources(db)).find(
    (r) =>
      r.kind === 'app' &&
      r.status === 'active' &&
      r.card?.client === clientId &&
      r.card.product === e.product,
  );
  if (!app) return { id: e.id, outcome: 'refused', reason: 'unknown_app' };
  const declared = app.card?.emits?.find((d) => d.type === e.type);
  if (!declared) return { id: e.id, outcome: 'refused', reason: 'undeclared_type' };
  const { rows } = await db.query<{ event_id: string }>(
    `insert into app_events (event_id, organization_id, product, resource_id, type, description,
       classification, occurred_at, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (event_id) do nothing returning event_id`,
    [
      e.id,
      e.organization,
      e.product,
      app.resourceId,
      e.type,
      declared.description,
      declared.classification ?? 'internal',
      e.occurred_at,
      JSON.stringify(e.data),
    ],
  );
  return { id: e.id, outcome: rows.length > 0 ? 'accepted' : 'duplicate' };
}

export interface AppNews {
  app: string;
  type: string;
  description: string;
  count: number;
  last: string;
}

/**
 * What the person's apps announced since a moment, counted by type: from the apps her registry
 * shows her, whose rights — once managed here — give her something; never a secret event.
 */
export async function appNewsFor(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
  since: Date,
): Promise<AppNews[]> {
  const visible = (await registryFor(db, identity)).resources.filter(
    (r) => r.kind === 'app' && r.status === 'active' && r.card,
  );
  const allowed: { resourceId: string; name: string }[] = [];
  for (const r of visible) {
    const grants = await appGrants(db, identity, r.card?.product ?? '');
    if (!grants.managed || grants.permissions.length > 0) allowed.push(r);
  }
  if (allowed.length === 0) return [];
  const names = new Map(allowed.map((r) => [r.resourceId, r.name]));
  const { rows } = await db.query<{
    resource_id: string;
    type: string;
    description: string;
    count: string;
    last: Date;
  }>(
    `select resource_id, type, min(description) as description, count(*) as count,
            max(occurred_at) as last
       from app_events
      where resource_id = any($1) and occurred_at >= $2 and classification <> 'secret'
      group by resource_id, type
      order by max(occurred_at) desc
      limit 50`,
    [[...names.keys()], since],
  );
  return rows.map((r) => ({
    app: names.get(r.resource_id) ?? '',
    type: r.type,
    description: r.description,
    count: Number(r.count),
    last: r.last.toISOString(),
  }));
}
