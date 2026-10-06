import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { appsHeardBy } from '../apps/index.js';
import { listSchedules } from '../assistant/index.js';
import { figuresFor, readFigure } from '../dashboards/index.js';
import { readModules } from '../organization/index.js';
import {
  createTrigger,
  createWatch,
  listRuns,
  listTriggers,
  listWatches,
  removeRoutine,
  RoutineLimitError,
  setRoutineActive,
  triggerInput,
  watchInput,
  type Person,
} from './routines.js';
import { checkWatch, tryTrigger } from './runs.js';
import { NoModelError, understandRoutine, type Choices } from './understand.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

/** Her routines are hers to set: never while an administrator views her space. */
function herself(c: Ctx): Identity {
  if (c.get('viewedBy')) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only the person sets her own routines.');
  }
  return c.get('identity');
}

const personOf = (identity: Identity, locale: 'fr' | 'en' = 'fr'): Person => ({
  organizationId: identity.organizationId,
  userId: identity.userId,
  name: identity.name,
  email: identity.email,
  locale,
});

/** What she may build a routine on: the apps she hears, the figures she reads. */
async function choicesOf(identity: Identity): Promise<Choices> {
  return transaction(identity.organizationId, async (db) => ({
    apps: await appsHeardBy(db, identity),
    figures: (await readModules(db)).dashboards ? await figuresFor(db, identity) : [],
  }));
}

const isTrigger = z.string().regex(/^rtr_[0-9A-Za-z_-]{4,64}$/);
const isWatch = z.string().regex(/^rwt_[0-9A-Za-z_-]{4,64}$/);
const kindOf = (c: Ctx) => {
  const kind = c.req.param('kind');
  return kind === 'triggers' ? 'trigger' : kind === 'watches' ? 'watch' : null;
};
const idOf = (c: Ctx, kind: 'trigger' | 'watch') => {
  const parsed = (kind === 'trigger' ? isTrigger : isWatch).safeParse(c.req.param('id'));
  if (!parsed.success) throw new GestureRefusal(404, 'not_found', 'No such routine.');
  return parsed.data;
};

/** Her routines, under /v1/routines (spec 051). */
export const routineRoutes = new Hono<{ Variables: IdentityVariables }>()
  // The three families, her latest runs, and what she may build a routine on.
  .get('/', async (c) => {
    const identity = c.get('identity');
    const choices = await choicesOf(identity);
    const mine = await transaction(identity.organizationId, async (db) => ({
      schedules: await listSchedules(db, identity.userId),
      triggers: await listTriggers(db, identity.userId),
      watches: await listWatches(db, identity.userId),
      runs: await listRuns(db, identity.userId),
    }));
    return c.json({ ...mine, ...choices });
  })
  // Her sentence understood, with its plan: nothing is kept until she activates it.
  .post('/understand', async (c) => {
    const identity = herself(c);
    const parsed = z
      .object({ sentence: z.string().trim().min(3).max(1000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A sentence.');
    try {
      const proposal = await understandRoutine(
        identity,
        parsed.data.sentence,
        await choicesOf(identity),
      );
      if (!proposal) throw new GestureRefusal(422, 'not_understood', 'Nothing she may use.');
      return c.json({ proposal });
    } catch (error) {
      if (error instanceof NoModelError) {
        throw new GestureRefusal(409, 'assistant_unavailable', 'No model configured.');
      }
      throw error;
    }
  })
  // When an app signals: an app she hears, one of the event types it declares.
  .post('/triggers', async (c) => {
    const identity = herself(c);
    const parsed = triggerInput
      .extend({ locale: z.enum(['fr', 'en']).default('fr') })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A trigger.');
    const { locale, ...input } = parsed.data;
    const trigger = await transaction(identity.organizationId, async (db) => {
      const app = (await appsHeardBy(db, identity)).find((a) => a.resourceId === input.resourceId);
      if (!app?.emits.some((e) => e.type === input.eventType)) {
        throw new GestureRefusal(422, 'unknown_event', 'Not an event she hears.');
      }
      return createTrigger(db, personOf(identity, locale), input).catch((error: unknown) => {
        if (error instanceof RoutineLimitError) {
          throw new GestureRefusal(409, 'too_many', 'Too many routines.');
        }
        throw error;
      });
    });
    return c.json({ trigger }, 201);
  })
  // En veille: a figure card of a dashboard she reads, and a line.
  .post('/watches', async (c) => {
    const identity = herself(c);
    const parsed = watchInput
      .extend({ locale: z.enum(['fr', 'en']).default('fr') })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A watch.');
    const { locale, ...input } = parsed.data;
    const watch = await transaction(identity.organizationId, async (db) => {
      if (!(await readFigure(db, identity, input.dashboardId, input.cardId))) {
        throw new GestureRefusal(422, 'unknown_figure', 'Not a figure she reads.');
      }
      return createWatch(db, personOf(identity, locale), input).catch((error: unknown) => {
        if (error instanceof RoutineLimitError) {
          throw new GestureRefusal(409, 'too_many', 'Too many routines.');
        }
        throw error;
      });
    });
    return c.json({ watch }, 201);
  })
  .post('/:kind/:id/active', async (c) => {
    const identity = herself(c);
    const kind = kindOf(c);
    if (!kind) throw new GestureRefusal(404, 'not_found', 'No such routine.');
    const id = idOf(c, kind);
    const parsed = z.object({ active: z.boolean() }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Active or not.');
    const done = await transaction(identity.organizationId, (db) =>
      setRoutineActive(db, kind, id, identity.userId, parsed.data.active),
    );
    if (!done) throw new GestureRefusal(404, 'not_found', 'No such routine.');
    return c.json({ active: parsed.data.active });
  })
  .post('/:kind/:id/remove', async (c) => {
    const identity = herself(c);
    const kind = kindOf(c);
    if (!kind) throw new GestureRefusal(404, 'not_found', 'No such routine.');
    const id = idOf(c, kind);
    const removed = await transaction(identity.organizationId, (db) =>
      removeRoutine(db, kind, id, identity.userId),
    );
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such routine.');
    return c.json({ removed });
  })
  // « Essayer maintenant »: once, at once, kept in her history.
  .post('/:kind/:id/try', async (c) => {
    const identity = herself(c);
    const kind = kindOf(c);
    if (!kind) throw new GestureRefusal(404, 'not_found', 'No such routine.');
    const id = idOf(c, kind);
    const status =
      kind === 'trigger'
        ? await tryTrigger(identity, id)
        : await checkWatch(identity.organizationId, id, { tried: true, userId: identity.userId });
    if (!status) throw new GestureRefusal(404, 'not_found', 'No such routine.');
    return c.json({ status }, 201);
  });
