import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { findAgent, personOfAgent } from '../agents/index.js';
import { objectCard } from '../objects/index.js';
import { listResources } from '../registry/index.js';
import { isAdministrator, reach } from '../rights/index.js';
import { listenForEvents, onObjectChange } from './dispatch.js';
import { subscriptionInput } from './events.js';
import {
  findSubscription,
  followEvents,
  listSubscriptions,
  setSubscription,
  SubscriptionRefusal,
} from './subscriptions.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

async function managesAgents(c: Ctx, db: SqlExecutor): Promise<boolean> {
  return (await reach(db, c.get('identity'), 'agents:manage')).everywhere;
}

/** An agent's subscriptions are its person's, or a manager of agents'. */
async function mayDirect(c: Ctx, db: SqlExecutor, agentId: string): Promise<void> {
  const agent = await findAgent(db, agentId);
  if (!agent) throw new GestureRefusal(404, 'not_found', 'No such agent here.');
  if ((await personOfAgent(db, agent)) === c.get('identity').userId) return;
  if (await managesAgents(c, db)) return;
  throw new GestureRefusal(
    403,
    'forbidden',
    'Only the person an agent acts for, or a manager of agents.',
  );
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof SubscriptionRefusal) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 422, error.code, error.message);
    }
    throw error;
  }
}

/** The event path, under /v1/events (spec 101): who follows what, and what failed to arrive. */
export const eventsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/subscriptions', async (c: Ctx) => {
    const identity = c.get('identity');
    const agent = c.req.query('agent');
    return c.json({
      subscriptions: await transaction(identity.organizationId, async (db) => {
        if (agent) {
          await mayDirect(c, db, agent);
          return listSubscriptions(db, agent);
        }
        if (!(await managesAgents(c, db))) throw new GestureRefusal(403, 'forbidden', 'Agents.');
        return listSubscriptions(db);
      }),
    });
  })
  .post('/subscriptions', async (c: Ctx) => {
    const identity = c.get('identity');
    const body = subscriptionInput.safeParse(await bodyOf(c));
    if (!body.success) throw new GestureRefusal(422, 'invalid', 'This is not a subscription.');
    await transaction(identity.organizationId, (db) => mayDirect(c, db, body.data.consumerId));
    return c.json(await run(c, followEvents, { ...body.data, createdBy: identity.userId }), 201);
  })
  .patch('/subscriptions/:id', async (c: Ctx) => {
    const identity = c.get('identity');
    const id = c.req.param('id') ?? '';
    const body = (await bodyOf(c)) as { active?: unknown };
    if (typeof body.active !== 'boolean') {
      throw new GestureRefusal(422, 'invalid', 'Say whether it is active.');
    }
    const found = await transaction(identity.organizationId, (db) => findSubscription(db, id));
    if (!found) throw new GestureRefusal(404, 'not_found', 'No such subscription.');
    await transaction(identity.organizationId, (db) => mayDirect(c, db, found.consumerId));
    return c.json(await run(c, setSubscription, { subscriptionId: id, active: body.active }));
  })
  // What could not reach its consumer: the administrator sees it, with its last error (FR-006).
  .get('/failures', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) throw new GestureRefusal(403, 'forbidden', 'Administrators.');
    const { rows } = await transaction(identity.organizationId, (db) =>
      db.query<{
        event_id: string;
        consumer_key: string;
        attempts: number;
        last_error: string | null;
        delivered_at: Date;
        type: string;
        label: string;
      }>(
        `select d.event_id, d.consumer_key, d.attempts, d.last_error, d.delivered_at, e.type, e.label
           from event_deliveries d join kete_events e using (organization_id, event_id)
          where d.status = 'failed' order by d.delivered_at desc limit 100`,
      ),
    );
    return c.json({
      failures: rows.map((r) => ({
        eventId: r.event_id,
        consumer: r.consumer_key,
        attempts: r.attempts,
        error: r.last_error,
        at: r.delivered_at.toISOString(),
        type: r.type,
        label: r.label,
      })),
    });
  });

/** What happened to an object she may read, the latest first (FR-007). */
export async function objectHistory(c: Ctx) {
  const identity = c.get('identity');
  const kind = c.req.param('kind') ?? '';
  const id = c.req.param('id') ?? '';
  const events = await transaction(identity.organizationId, async (db) => {
    if (!(await objectCard(db, identity, kind, id))) return null;
    const { rows } = await db.query<{
      event_id: string;
      source: string;
      product: string;
      type: string;
      label: string;
      data: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select event_id, source, product, type, label, data, occurred_at from kete_events
        where object_kind = $1 and object_id = $2 order by occurred_at desc limit 50`,
      [kind, id],
    );
    const apps = new Map(
      (await listResources(db))
        .filter((r) => r.kind === 'app' && r.card)
        .map((r) => [r.card?.product ?? '', r.name]),
    );
    return rows.map((r) => ({
      eventId: r.event_id,
      source: r.source,
      product: r.product,
      app: r.source === 'app' ? (apps.get(r.product) ?? r.product) : null,
      type: r.type,
      label: r.label,
      data: r.source === 'index' ? r.data : {},
      occurredAt: r.occurred_at.toISOString(),
    }));
  });
  if (!events) throw new GestureRefusal(404, 'not_found', 'No such object of hers.');
  return c.json({ events });
}

/**
 * `GET /v1/objects/:kind/:id/live`: the screen open on an object is told when it changes, then
 * reads it again — what it shows always comes from the API, never from the stream (FR-008).
 */
export async function objectLive(c: Ctx) {
  const identity = c.get('identity');
  const kind = c.req.param('kind') ?? '';
  const id = c.req.param('id') ?? '';
  const card = await transaction(identity.organizationId, (db) =>
    objectCard(db, identity, kind, id),
  );
  if (!card) throw new GestureRefusal(404, 'not_found', 'No such object of hers.');
  return streamSSE(c, async (stream) => {
    const listening = await listenForEvents({ dispatch: false });
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    const stop = onObjectChange((change) => {
      if (!open || change.organizationId !== identity.organizationId) return;
      if (change.kind !== kind || change.id !== id) return;
      void stream.writeSSE({ event: 'object', data: JSON.stringify({ kind, id }) });
    });
    let since = new Date();
    try {
      for (let beat = 0; open; beat += 1) {
        await stream.sleep(listening ? 25_000 : 5000);
        if (!open) break;
        if (!listening) {
          const now = new Date();
          const { rows } = await transaction(identity.organizationId, (db) =>
            db.query(
              `select 1 from kete_events where object_kind = $1 and object_id = $2
                 and recorded_at > $3 limit 1`,
              [kind, id, since],
            ),
          );
          since = now;
          if (rows.length > 0) {
            await stream.writeSSE({ event: 'object', data: JSON.stringify({ kind, id }) });
          }
        }
        // A beat keeps proxies from closing a quiet stream.
        await stream.writeSSE({ event: 'beat', data: String(beat) });
      }
    } finally {
      stop();
    }
  });
}
