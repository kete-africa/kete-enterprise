import type { SqlExecutor } from '@kete/tenancy';
import { postMessage } from '@kete/threads';
import pg from 'pg';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { findAgent, personOfAgent } from '../agents/index.js';
import { KETE, giveToAgent } from '../messages/index.js';
import { kindsOf } from '../objects/index.js';
import { readModules } from '../organization/index.js';
import { listResources } from '../registry/index.js';
import { follows, type KeteEventRow, type Subscription } from './events.js';
import { followLife } from './life.js';
import { eventWords } from './words.js';

// The dispatcher (spec 101; ADR 0017): each recorded event goes to whoever depends on it — the
// object's thread for an app's business event, the agents that subscribed. One delivery per event
// and consumer, claimed in the same transaction as its effect: a replay acts once; a failure is
// kept and retried, five times at most, then shown. The event is « seen » when every consumer is
// done or has given up, so the worker stops scanning it.

/** A consumer of one event: its key in the deliveries, and its effect in the delivery's transaction. */
export type Consumer = [key: string, effect: (db: SqlExecutor) => Promise<void>];
type ConsumerProvider = (
  db: SqlExecutor,
  organizationId: string,
  event: KeteEventRow,
) => Promise<Consumer[]>;
const providers: ConsumerProvider[] = [];

/**
 * A feature that depends on events says who it is a consumer for (spec 114): the routines an app's
 * event triggers. It lends them here, so the event path never imports the features above it.
 */
export function provideConsumers(provider: ConsumerProvider): void {
  providers.push(provider);
}

/** How many times a failing consumer is tried. */
export const ATTEMPTS = 5;

type Row = {
  event_id: string;
  source: 'app' | 'index' | 'center';
  product: string;
  type: string;
  object_kind: string | null;
  object_id: string | null;
  label: string;
  data: Record<string, unknown>;
  occurred_at: Date;
};
const eventOf = (r: Row): KeteEventRow => ({
  eventId: r.event_id,
  source: r.source,
  product: r.product,
  type: r.type,
  object: r.object_kind && r.object_id ? { kind: r.object_kind, id: r.object_id } : null,
  label: r.label,
  data: r.data,
  occurredAt: r.occurred_at.toISOString(),
});

async function subscriptionsOf(db: SqlExecutor): Promise<Subscription[]> {
  const { rows } = await db.query<{
    subscription_id: string;
    consumer: 'agent';
    consumer_id: string;
    type_pattern: string;
    object_kind: string | null;
    state: string | null;
    active: boolean;
  }>(`select * from event_subscriptions where active`);
  return rows.map((r) => ({
    subscriptionId: r.subscription_id,
    consumer: r.consumer,
    consumerId: r.consumer_id,
    type: r.type_pattern,
    objectKind: r.object_kind,
    state: r.state,
    active: r.active,
  }));
}

async function objectThread(db: SqlExecutor, object: { kind: string; id: string }) {
  const { rows } = await db.query<{ thread_id: string; state: string }>(
    `select thread_id, state from kete_threads where kind = 'object' and object_kind = $1
       and object_id = $2 limit 1`,
    [object.kind, object.id],
  );
  return rows[0] && rows[0].state !== 'closed' ? rows[0].thread_id : null;
}

async function titleOf(db: SqlExecutor, object: { kind: string; id: string } | null) {
  if (!object) return '';
  const { rows } = await db.query<{ title: string }>(
    `select title from kete_objects where kind = $1 and object_id = $2`,
    [object.kind, object.id],
  );
  return rows[0]?.title ?? '';
}

/** An app's business event about an object: one line in the object's thread, said by Kete. */
async function toThread(db: SqlExecutor, organizationId: string, event: KeteEventRow) {
  if (!event.object) return;
  const thread = await objectThread(db, event.object);
  if (!thread) return;
  const app =
    (await listResources(db)).find((r) => r.kind === 'app' && r.card?.product === event.product)
      ?.name ?? event.product;
  const title = await titleOf(db, event.object);
  await postMessage(db, organizationId, {
    thread,
    author: KETE,
    text: eventWords().happened(app, title ? `${event.label} — ${title}` : event.label),
    for: 'information',
    via: 'kete',
  });
}

/** An event an agent follows: a task for it, answered in the object's thread when there is one. */
async function toAgent(
  db: SqlExecutor,
  organizationId: string,
  event: KeteEventRow,
  agentId: string,
) {
  if (!(await readModules(db)).agents) return;
  const agent = await findAgent(db, agentId);
  if (!agent || agent.status !== 'active') return;
  const person = await personOfAgent(db, agent);
  if (!person) return;
  const words = eventWords();
  const title = await titleOf(db, event.object);
  let details = '';
  if (event.type === 'object.state_changed' && event.object) {
    const kind = (await kindsOf(db)).find((k) => k.kind === event.object?.kind);
    const label = (state: unknown) =>
      kind?.states.find((s) => s.id === state)?.label.fr ?? String(state ?? '');
    details = words.stateChanged(label(event.data['from']), label(event.data['to']));
  } else if (event.type === 'object.created') details = words.created;
  const thread = event.object ? await objectThread(db, event.object) : null;
  await giveToAgent(db, organizationId, {
    agent,
    givenBy: person,
    instruction: words.toAgent(event.source === 'index' ? event.type : event.label, title, details),
    ...(thread ? { threadId: thread } : {}),
  });
}

/**
 * Claims one delivery and runs its effect in the same transaction: done once. A failure rolls the
 * effect back and is kept, with its attempts, to be tried again.
 */
async function deliver(
  organizationId: string,
  eventId: string,
  key: string,
  effect: (db: SqlExecutor) => Promise<void>,
): Promise<'done' | 'skipped' | 'failed'> {
  try {
    return await transaction(organizationId, async (db) => {
      const { rows } = await db.query(
        `insert into event_deliveries (organization_id, event_id, consumer_key, status)
         values ($1, $2, $3, 'done')
         on conflict (organization_id, event_id, consumer_key) do update
           set status = 'done', attempts = event_deliveries.attempts + 1, delivered_at = now(),
               last_error = null
           where event_deliveries.status = 'failed' and event_deliveries.attempts < ${ATTEMPTS}
         returning consumer_key`,
        [organizationId, eventId, key],
      );
      if (rows.length === 0) return 'skipped' as const;
      await effect(db);
      return 'done' as const;
    });
  } catch (error) {
    await transaction(organizationId, (db) =>
      db.query(
        `insert into event_deliveries (organization_id, event_id, consumer_key, status, last_error)
         values ($1, $2, $3, 'failed', $4)
         on conflict (organization_id, event_id, consumer_key) do update
           set status = 'failed', attempts = event_deliveries.attempts + 1,
               last_error = excluded.last_error, delivered_at = now()`,
        [organizationId, eventId, key, String((error as Error).message ?? error).slice(0, 500)],
      ),
    ).catch(() => undefined);
    return 'failed';
  }
}

/** Delivers an organization's events not yet seen; answers how many deliveries were made. */
export async function dispatchEvents(organizationId: string): Promise<number> {
  const { events, subscriptions } = await transaction(organizationId, async (db) => {
    const { rows } = await db.query<Row>(
      `select e.event_id, e.source, e.product, e.type, e.object_kind, e.object_id, e.label, e.data,
              e.occurred_at
         from kete_events e
        where e.recorded_at > now() - interval '3 days'
          and not exists (select 1 from event_deliveries d
                           where d.event_id = e.event_id and d.consumer_key = 'seen')
        order by e.recorded_at limit 200`,
    );
    return { events: rows.map(eventOf), subscriptions: await subscriptionsOf(db) };
  });
  let made = 0;
  for (const event of events) {
    const consumers: Consumer[] = [];
    if (event.source === 'app' && event.object) {
      consumers.push(['thread', (db) => toThread(db, organizationId, event)]);
    }
    // An object closed puts its thread away; opened again, its thread opens (spec 107, R12).
    if (event.source === 'index' && event.type === 'object.state_changed') {
      consumers.push(['life', (db) => followLife(db, event)]);
    }
    for (const subscription of subscriptions.filter((s) => follows(s, event))) {
      consumers.push([
        `subscription:${subscription.subscriptionId}`,
        (db) => toAgent(db, organizationId, event, subscription.consumerId),
      ]);
    }
    for (const provider of providers) {
      consumers.push(
        ...(await transaction(organizationId, (db) => provider(db, organizationId, event))),
      );
    }
    let pending = false;
    for (const [key, effect] of consumers) {
      const outcome = await deliver(organizationId, event.eventId, key, effect);
      if (outcome === 'done') made += 1;
      if (outcome === 'failed') {
        const { rows } = await transaction(organizationId, (db) =>
          db.query<{ attempts: number }>(
            `select attempts from event_deliveries where event_id = $1 and consumer_key = $2`,
            [event.eventId, key],
          ),
        );
        if ((rows[0]?.attempts ?? 0) < ATTEMPTS) pending = true;
      }
    }
    if (!pending) await deliver(organizationId, event.eventId, 'seen', async () => undefined);
  }
  return made;
}

/** The worker, every minute: every organization with an event not yet seen (a safety net). */
export async function dispatchPending(): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string }>(
    'select organization_id from kete_events_pending()',
  );
  let made = 0;
  for (const { organization_id: organizationId } of rows) {
    try {
      made += await dispatchEvents(organizationId);
    } catch (error) {
      console.error(`[events] ${organizationId} could not be dispatched`, error);
    }
  }
  return made;
}

// ---- live: one listener per process, announcing each event as it is recorded ----

export interface ObjectChange {
  organizationId: string;
  kind: string | null;
  id: string | null;
}
type ChangeListener = (change: ObjectChange) => void;
const changeListeners = new Set<ChangeListener>();
const soon = new Map<string, ReturnType<typeof setTimeout>>();
let starting: Promise<boolean> | null = null;

/** Hears every change of an object as it is recorded (the screens open on it). */
export function onObjectChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Dispatches an organization's events in a moment, once however many arrive meanwhile. */
export function dispatchSoon(organizationId: string): void {
  if (soon.has(organizationId)) return;
  soon.set(
    organizationId,
    setTimeout(() => {
      soon.delete(organizationId);
      void dispatchEvents(organizationId).catch((error: unknown) =>
        console.error(`[events] ${organizationId} could not be dispatched`, error),
      );
    }, 300),
  );
}

/**
 * Listens to Postgres' announcements of new events once per process: dispatches them at once and
 * tells the screens. Where Postgres cannot be listened to (a transaction pooler), the worker's
 * minute does the dispatch, and the screens read again when they are told by their own stream.
 */
export function listenForEvents(options: { dispatch: boolean }): Promise<boolean> {
  starting ??= (async () => {
    try {
      const client = new pg.Client({ connectionString: env.databaseUrl });
      client.on('error', () => undefined);
      await client.connect();
      client.on('notification', (message) => {
        if (message.channel !== 'kete_events' || !message.payload) return;
        let change: { o?: string; k?: string | null; i?: string | null } = {};
        try {
          change = JSON.parse(message.payload) as typeof change;
        } catch {
          return;
        }
        if (!change.o) return;
        if (options.dispatch) dispatchSoon(change.o);
        for (const listener of changeListeners) {
          listener({ organizationId: change.o, kind: change.k ?? null, id: change.i ?? null });
        }
      });
      await client.query('listen kete_events');
      return true;
    } catch {
      return false;
    }
  })();
  return starting;
}
