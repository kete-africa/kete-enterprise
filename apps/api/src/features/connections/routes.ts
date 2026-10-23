import type { CommandDefinition } from '@kete/commands';
import { verifyWebhook } from '@kete/connections';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { getPool, transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import {
  ConnectionRefusal,
  connectionsOf,
  openWebhook,
  setConnectionGrants,
  webhookOf,
  webhookSecret,
} from './connections.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof ConnectionRefusal) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 422, error.code, error.message);
    }
    throw error;
  }
}

const administrators = (c: Ctx) => {
  if (!isAdministrator(c.get('identity'))) {
    throw new GestureRefusal(403, 'forbidden', 'An administrator manages the connections.');
  }
};

/** The connections, under /v1/connections (spec 105): seen once, each with its three uses. */
export const connectionsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    administrators(c);
    const { organizationId } = c.get('identity');
    return c.json({ connections: await transaction(organizationId, (db) => connectionsOf(db)) });
  })
  .post('/:id/grants', async (c: Ctx) => {
    administrators(c);
    const body = (await bodyOf(c)) as object;
    return c.json(await run(c, setConnectionGrants, { ...body, connectionId: c.req.param('id') }));
  })
  // A new webhook secret: said once, here, to set in the tool; never again.
  .post('/:id/webhook', async (c: Ctx) => {
    administrators(c);
    const made = webhookSecret();
    if (!made) throw new GestureRefusal(422, 'no_secrets', 'Secrets cannot be kept here.');
    await run(c, openWebhook, {
      connectionId: c.req.param('id'),
      sealed: made.sealed,
      by: c.get('identity').userId,
    });
    return c.json({ secret: made.secret, header: 'kete-signature' }, 201);
  });

const typePattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const objectPattern = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * `POST /public/connections/:id/webhook`: an external tool says what happened, signed with its
 * connection's secret (`kete-signature: sha256=…`). Kept once on the event path, with the object it
 * names; refused unsigned, or signed by another.
 */
export async function connectionWebhook(c: Context) {
  const id = c.req.param('id') ?? '';
  const raw = await c.req.text();
  if (raw.length > 64_000) return c.json({ error: 'too_large' }, 413);
  if (!/^(tls|cnr)_[0-9a-f-]{8,64}$/.test(id)) return c.json({ error: 'unknown' }, 404);
  const hook = await webhookOf(getPool(), id);
  // Unknown and wrongly signed answer alike: nothing is said about a connection to a stranger.
  if (!hook || !verifyWebhook(hook.secret, raw, c.req.header('kete-signature') ?? null)) {
    return c.json({ error: 'refused' }, 401);
  }
  let event: {
    id?: unknown;
    type?: unknown;
    description?: unknown;
    object?: { kind?: unknown; id?: unknown };
    data?: unknown;
  };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return c.json({ error: 'invalid' }, 422);
  }
  const eventId = typeof event.id === 'string' ? event.id.slice(0, 120) : '';
  const type = typeof event.type === 'string' ? event.type : '';
  const kind = typeof event.object?.kind === 'string' ? event.object.kind : null;
  const objectId = typeof event.object?.id === 'string' ? event.object.id.slice(0, 128) : null;
  if (!eventId || !typePattern.test(type) || (kind !== null && !objectPattern.test(kind))) {
    return c.json({ error: 'invalid' }, 422);
  }
  const kept = await transaction(hook.organizationId, async (db) => {
    const { rows } = await db.query(
      `insert into kete_events (organization_id, event_id, source, product, type, object_kind,
         object_id, label, data)
       values ($1, $2, 'connection', $3, $4, $5, $6, $7, $8)
       on conflict do nothing returning event_id`,
      [
        hook.organizationId,
        `${id}:${eventId}`,
        `connection:${id}`,
        type,
        kind && objectId ? kind : null,
        kind && objectId ? objectId : null,
        (typeof event.description === 'string' ? event.description : type).slice(0, 300),
        JSON.stringify(event.data && typeof event.data === 'object' ? event.data : {}),
      ],
    );
    return rows.length > 0;
  });
  return c.json({ outcome: kept ? 'accepted' : 'duplicate' }, 202);
}
