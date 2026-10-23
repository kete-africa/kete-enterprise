import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// One event path (spec 101; doctrine D-062, R11; kete-core ADR 0017 and spec 143): what changes
// says so, once, in one log — an app's business event, an object of the index created or changed
// state — and whoever depends on it learns it: its thread, the agents that follow it, the screens
// open on it. Subscriptions are data; each delivery is kept, so a replay acts once; a consumer that
// fails is retried, then shown.

export function eventsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.kete_events (
  organization_id text not null,
  event_id text not null,
  -- 'app': an app's business event; 'index': an object of the index created or changed state.
  source text not null check (source in ('app', 'index')),
  -- Its owner: 'center', or the app's product.
  product text not null,
  type text not null check (type ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'),
  object_kind text,
  object_id text,
  -- What a person reads of it: the app's description of its type, or the object's title.
  label text not null default '' check (length(label) <= 300),
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  primary key (organization_id, event_id),
  check ((object_kind is null) = (object_id is null))
);
create index kete_events_recent on ${s}.kete_events (organization_id, recorded_at desc);
create index kete_events_object on ${s}.kete_events (organization_id, object_kind, object_id)
  where object_kind is not null;
${policy('kete_events')}
revoke all on ${s}.kete_events from ${options.appRole};
grant select, insert on ${s}.kete_events to ${options.appRole};

-- Who follows what: an agent, on a type of event, a kind of object, a state it reaches.
create table ${s}.event_subscriptions (
  organization_id text not null,
  subscription_id text not null,
  consumer text not null check (consumer in ('agent')),
  consumer_id text not null,
  -- An exact type, or a family: 'object.state_changed', 'ticket.*'.
  type_pattern text not null check (type_pattern ~ '^[a-z][a-z0-9_]*(\\.([a-z][a-z0-9_]*|\\*))+$'),
  object_kind text,
  -- For an object's change of state: the state it reaches.
  state text,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, subscription_id)
);
${policy('event_subscriptions')}
grant select, insert, update on ${s}.event_subscriptions to ${options.appRole};

-- Each event, once per consumer: kept so that a replay acts once, retried when it failed.
create table ${s}.event_deliveries (
  organization_id text not null,
  event_id text not null,
  consumer_key text not null,
  status text not null check (status in ('done', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text check (length(last_error) <= 500),
  delivered_at timestamptz not null default now(),
  primary key (organization_id, event_id, consumer_key)
);
${policy('event_deliveries')}
grant select, insert, update on ${s}.event_deliveries to ${options.appRole};

-- An object of the index that is born or changes state says so (R11).
create function ${s}.kete_events_of_object() returns trigger language plpgsql as $f$
begin
  if tg_op = 'INSERT' then
    insert into ${s}.kete_events (organization_id, event_id, source, product, type, object_kind,
      object_id, label, data)
    values (new.organization_id, 'evt_' || gen_random_uuid(), 'index', new.product, 'object.created',
      new.kind, new.object_id, left(new.title, 300), jsonb_build_object('state', new.state));
  elsif new.state is distinct from old.state then
    insert into ${s}.kete_events (organization_id, event_id, source, product, type, object_kind,
      object_id, label, data)
    values (new.organization_id, 'evt_' || gen_random_uuid(), 'index', new.product,
      'object.state_changed', new.kind, new.object_id, left(new.title, 300),
      jsonb_build_object('from', old.state, 'to', new.state));
  end if;
  return new;
end $f$;
create trigger kete_events_object after insert or update on ${s}.kete_objects
  for each row execute function ${s}.kete_events_of_object();

-- Every new event is announced: the process listening dispatches it at once.
create function ${s}.kete_events_announce() returns trigger language plpgsql as $f$
begin
  perform pg_notify('kete_events', json_build_object(
    'o', new.organization_id, 'k', new.object_kind, 'i', new.object_id)::text);
  return new;
end $f$;
create trigger kete_events_announce after insert on ${s}.kete_events
  for each row execute function ${s}.kete_events_announce();

-- The worker learns which organizations have events left to deliver: identifiers only.
create function ${s}.kete_events_pending() returns table (organization_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select distinct e.organization_id from kete_events e
         where e.recorded_at > now() - interval '3 days'
           and not exists (select 1 from event_deliveries d
                            where d.organization_id = e.organization_id
                              and d.event_id = e.event_id and d.consumer_key = 'seen') $$;
revoke all on function ${s}.kete_events_pending() from public;
grant execute on function ${s}.kete_events_pending() to ${options.appRole};
`;
}

export interface KeteEventRow {
  eventId: string;
  source: 'app' | 'index';
  product: string;
  type: string;
  object: { kind: string; id: string } | null;
  label: string;
  data: Record<string, unknown>;
  occurredAt: string;
}

/** Records an app's accepted business event in the log, with the object it names (spec 143). */
export async function logAppEvent(
  db: SqlExecutor,
  organizationId: string,
  event: {
    eventId: string;
    product: string;
    type: string;
    description: string;
    occurredAt: string;
    data: Record<string, unknown>;
    object?: { kind: string; id: string } | undefined;
  },
): Promise<void> {
  await db.query(
    `insert into kete_events (organization_id, event_id, source, product, type, object_kind,
       object_id, label, data, occurred_at)
     values ($1, $2, 'app', $3, $4, $5, $6, $7, $8, $9) on conflict do nothing`,
    [
      organizationId,
      event.eventId,
      event.product,
      event.type,
      event.object?.kind ?? null,
      event.object?.id ?? null,
      event.description.slice(0, 300),
      JSON.stringify(event.data),
      event.occurredAt,
    ],
  );
}

export const subscriptionInput = z.object({
  consumer: z.literal('agent'),
  consumerId: z.string().regex(/^agt_[0-9a-zA-Z_-]{4,80}$/),
  type: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.([a-z][a-z0-9_]*|\*))+$/)
    .max(100),
  objectKind: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,40}$/)
    .optional(),
  state: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,40}$/)
    .optional(),
});

export interface Subscription {
  subscriptionId: string;
  consumer: 'agent';
  consumerId: string;
  type: string;
  objectKind: string | null;
  state: string | null;
  active: boolean;
}

/** Whether an event is one a subscription follows. */
export function follows(subscription: Subscription, event: KeteEventRow): boolean {
  if (!subscription.active) return false;
  const pattern = subscription.type;
  const typeOk = pattern.endsWith('.*')
    ? event.type.startsWith(pattern.slice(0, -1))
    : pattern === event.type;
  if (!typeOk) return false;
  if (subscription.objectKind && event.object?.kind !== subscription.objectKind) return false;
  if (subscription.state && event.data['to'] !== subscription.state) return false;
  return true;
}
