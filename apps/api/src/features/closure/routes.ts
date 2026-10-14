import type { StoredProposalSet } from '@kete/drafts';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { applyEvening, dismissEvening, understandEvening, undoEvening } from './closure.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** A set as the screens show it. */
const shown = (stored: StoredProposalSet) => ({
  id: stored.set.id,
  status: stored.status,
  items: stored.set.items.map((item) => ({
    key: item.key,
    gesture: item.gesture,
    label: item.label,
    reason: item.reason ?? null,
    level: item.level,
    ticked: item.ticked ?? false,
  })),
  outcomes: Object.fromEntries(stored.outcomes.map((o) => [o.key, o.state])),
});

const person = (c: Ctx) => {
  if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to decide.');
  const { organizationId, userId } = c.get('identity');
  return { organizationId, userId };
};

const found = <T>(value: T | null): T => {
  if (!value) throw new GestureRefusal(404, 'not_found', 'No such set of hers.');
  return value;
};

/**
 * The evening's closure, under /v1/closure (spec 083): her note understood as gestures on her
 * To do, decided by her — applied together, undone together.
 */
export const closureRoutes = new Hono<{ Variables: IdentityVariables }>()
  .post('/', async (c: Ctx) => {
    const parsed = z
      .object({ text: z.string().trim().min(1).max(4000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Her note.');
    const who = person(c);
    const understood = await transaction(who.organizationId, (db) =>
      understandEvening(db, who, parsed.data.text),
    );
    if (understood.status === 'not_connected') {
      throw new GestureRefusal(409, 'assistant_unavailable', 'No model is configured.');
    }
    return c.json(
      understood.status === 'proposed'
        ? { set: shown(understood.set), unclear: understood.unclear }
        : { set: null, unclear: understood.unclear },
    );
  })
  .post('/:id/apply', async (c: Ctx) => {
    const parsed = z
      .object({ ticked: z.array(z.string().max(100)).max(30) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What she ticked.');
    const who = person(c);
    const id = c.req.param('id') ?? '';
    const stored = await transaction(who.organizationId, (db) =>
      applyEvening(db, who, id, parsed.data.ticked),
    );
    return c.json({ set: shown(found(stored)) });
  })
  .post('/:id/dismiss', async (c: Ctx) => {
    const who = person(c);
    const id = c.req.param('id') ?? '';
    const stored = await transaction(who.organizationId, (db) => dismissEvening(db, who, id));
    return c.json({ set: shown(found(stored)) });
  })
  .post('/:id/undo', async (c: Ctx) => {
    const who = person(c);
    const id = c.req.param('id') ?? '';
    const stored = await transaction(who.organizationId, (db) => undoEvening(db, who, id));
    return c.json({ set: shown(found(stored)) });
  });
