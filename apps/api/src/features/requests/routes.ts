import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import {
  addRule,
  clearAbsence,
  ReceptionRefusal,
  receptionOf,
  removeRule,
  setAbsence,
  tryReception,
} from './reception.js';
import {
  askColleague,
  colleagueOf,
  moveRequest,
  readRequest,
  RequestRefusal,
  requestsOf,
} from './requests.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

const askInput = z.object({
  colleague: z.string().trim().min(2).max(128),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const moveInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('take') }),
  z.object({ kind: z.literal('hand'), agentId: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('wait'), question: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal('answer'), text: z.string().trim().min(1).max(4000) }),
  z.object({ kind: z.literal('note'), text: z.string().trim().min(1).max(4000) }),
  z.object({ kind: z.literal('return'), text: z.string().trim().min(1).max(8000) }),
  z.object({ kind: z.literal('decline'), reason: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal('cancel') }),
  z.object({ kind: z.literal('remind') }),
]);

const statusOf: Record<RequestRefusal['reason'], number> = {
  not_found: 404,
  herself: 422,
  ambiguous: 422,
  not_hers: 403,
  not_possible: 409,
  not_her_agent: 403,
  too_soon: 429,
};

function refuse(error: unknown): never {
  if (error instanceof RequestRefusal) {
    throw new GestureRefusal(statusOf[error.reason] as 404, error.reason, error.reason);
  }
  if (error instanceof ReceptionRefusal) {
    const status = { not_her_agent: 403, too_many: 409, not_found: 404 } as const;
    throw new GestureRefusal(status[error.reason], error.reason, error.reason);
  }
  throw error;
}

/** Requests to colleagues (spec 065), under /v1/requests: hers only, sent or received. */
export const requestRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, (db) => requestsOf(db, identity.userId)),
    );
  })
  .post('/', async (c: Ctx) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to ask.');
    const parsed = askInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A colleague, a title.');
    const identity = c.get('identity');
    const request = await transaction(identity.organizationId, (db) =>
      askColleague(db, identity, parsed.data),
    ).catch(refuse);
    return c.json({ request }, 201);
  })
  .get('/:requestId', async (c: Ctx) => {
    const identity = c.get('identity');
    const found = await transaction(identity.organizationId, (db) =>
      readRequest(db, identity.userId, c.req.param('requestId') ?? ''),
    );
    if (!found) throw new GestureRefusal(404, 'not_found', 'No such request of hers.');
    return c.json({ request: found });
  })
  .post('/:requestId/moves', async (c: Ctx) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to move.');
    const parsed = moveInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Which move?');
    const identity = c.get('identity');
    const request = await transaction(identity.organizationId, (db) =>
      moveRequest(db, identity, c.req.param('requestId') ?? '', parsed.data),
    ).catch(refuse);
    return c.json({ request });
  });

const ruleInput = z.object({
  words: z.array(z.string().trim().min(2).max(60)).min(1).max(10),
  agentId: z.string().min(1).max(80),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const absenceInput = z
  .object({ startsOn: date, endsOn: date, colleague: z.string().trim().min(2).max(128) })
  .refine((absence) => absence.endsOn >= absence.startsOn);
const trialInput = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).optional(),
});

/**
 * « Mon accueil » (spec 067, doctrine D-044), under /v1/reception: hers alone — what arrives at
 * her and who takes care of it. Nobody else reads it, not even who asks her.
 */
export const receptionRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, (db) => receptionOf(db, identity.userId)),
    );
  })
  .post('/rules', async (c: Ctx) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to set.');
    const parsed = ruleInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Words, an agent.');
    const identity = c.get('identity');
    const reception = await transaction(identity.organizationId, async (db) => {
      await addRule(db, identity, parsed.data);
      return receptionOf(db, identity.userId);
    }).catch(refuse);
    return c.json(reception, 201);
  })
  .post('/rules/:ruleId/remove', async (c: Ctx) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to set.');
    const identity = c.get('identity');
    const reception = await transaction(identity.organizationId, async (db) => {
      await removeRule(db, identity.userId, c.req.param('ruleId') ?? '');
      return receptionOf(db, identity.userId);
    }).catch(refuse);
    return c.json(reception);
  })
  .post('/absence', async (c: Ctx) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to set.');
    const parsed = absenceInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Two days, a colleague.');
    const identity = c.get('identity');
    const reception = await transaction(identity.organizationId, async (db) => {
      // A colleague the directory shows her: the same reading as a request's.
      const delegate = await colleagueOf(db, identity, parsed.data.colleague);
      await setAbsence(db, identity, { ...parsed.data, delegate });
      return receptionOf(db, identity.userId);
    }).catch(refuse);
    return c.json(reception, 201);
  })
  .post('/absence/clear', async (c: Ctx) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to set.');
    const identity = c.get('identity');
    const reception = await transaction(identity.organizationId, async (db) => {
      await clearAbsence(db, identity.userId);
      return receptionOf(db, identity.userId);
    });
    return c.json(reception);
  })
  // « Essayer sur une demande »: what would become of it today. Nothing is written.
  .post('/try', async (c: Ctx) => {
    const parsed = trialInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A request.');
    const identity = c.get('identity');
    const trial = await transaction(identity.organizationId, (db) =>
      tryReception(db, identity.userId, `${parsed.data.title} ${parsed.data.detail ?? ''}`),
    );
    return c.json({ trial });
  });
