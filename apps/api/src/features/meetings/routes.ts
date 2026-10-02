import type { CommandDefinition } from '@kete/commands';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import {
  ActionRuleError,
  cancelAction,
  completeAction,
  createAction,
  readRegister,
} from '../actions/index.js';
import { requireModule } from '../organization/index.js';
import { isAdministrator, reach, reachesAnything } from '../rights/index.js';
import { personOfAccount } from '../structure/index.js';
import {
  addAgendaItem,
  defineMeetingType,
  draftNote,
  holdMeeting,
  listMeetings,
  listNotes,
  listTypes,
  MeetingRuleError,
  planMeeting,
  publishNote,
  publishRecord,
  readNote,
  recordDecision,
} from './meetings.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 013). */
export const meetingsPermissions = ['meetings:manage', 'meetings:publish'] as const;

async function refused<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof MeetingRuleError || error instanceof ActionRuleError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'not_yours' ? 403 : 409;
      throw new GestureRefusal(status, error.code, error.message);
    }
    throw error;
  }
}

async function holds(c: Ctx, permission: string): Promise<boolean> {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) =>
    reachesAnything(await reach(db, identity, permission)),
  );
}

function gesture<Input extends z.ZodType, Output>(
  permission: 'meetings:manage' | 'meetings:publish',
  definition: CommandDefinition<Input, Output>,
  param?: string,
) {
  return async (c: Ctx) => {
    if (!(await holds(c, permission))) {
      throw new GestureRefusal(403, 'forbidden', `This needs « ${permission} ».`);
    }
    const input = {
      ...((await bodyOf(c)) as object),
      ...(param ? { [param]: c.req.param(param) } : {}),
    };
    return c.json(await refused(runGesture(c, definition, input)), 201);
  };
}

async function myPerson(c: Ctx) {
  const identity = c.get('identity');
  return transaction(identity.organizationId, (db) => personOfAccount(db, identity.userId));
}

/** Meetings and decision notes, under /v1/meetings (spec 013). */
export const meetingsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('meetings'))
  .get('/', async (c) => {
    const manages = await holds(c, 'meetings:manage');
    const publishes = await holds(c, 'meetings:publish');
    const person = await myPerson(c);
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        types: await listTypes(db),
        // Records are readable by everyone concerned: here, the organization.
        meetings: (await listMeetings(db)).filter((m) => manages || m.status === 'recorded'),
        // Drafts are their writers' until published.
        notes: (await listNotes(db, person?.personId ?? null)).filter(
          (n) => n.status === 'published' || publishes,
        ),
        manages,
        publishes,
      })),
    );
  })
  .get('/meetings/:meetingId', async (c) => {
    const manages = await holds(c, 'meetings:manage');
    const { organizationId } = c.get('identity');
    const [meeting] = await transaction(organizationId, (db) =>
      listMeetings(db, c.req.param('meetingId')),
    );
    if (!meeting || (!manages && meeting.status !== 'recorded')) {
      throw new GestureRefusal(404, 'not_found', 'No such meeting.');
    }
    return c.json({ meeting, manages });
  })
  .post('/types', gesture('meetings:manage', defineMeetingType))
  .post('/meetings', gesture('meetings:manage', planMeeting))
  .post('/meetings/:meetingId/agenda', gesture('meetings:manage', addAgendaItem, 'meetingId'))
  .post('/meetings/:meetingId/hold', gesture('meetings:manage', holdMeeting, 'meetingId'))
  .post('/meetings/:meetingId/decisions', gesture('meetings:manage', recordDecision, 'meetingId'))
  .post('/meetings/:meetingId/publish', gesture('meetings:manage', publishRecord, 'meetingId'))
  .post('/notes', gesture('meetings:publish', draftNote))
  .post('/notes/:noteId/publish', gesture('meetings:publish', publishNote, 'noteId'))
  .post('/notes/:noteId/read', async (c) => {
    const person = await myPerson(c);
    if (!person) throw new GestureRefusal(403, 'forbidden', 'You have no person here.');
    return c.json(
      await refused(
        runGesture(c, readNote, { noteId: c.req.param('noteId'), personId: person.personId }),
      ),
      201,
    );
  });

/** The register of actions, under /v1/actions (spec 013): mine, or all for who runs it. */
export const actionsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const identity = c.get('identity');
    const everything =
      isAdministrator(identity) ||
      (await holds(c, 'meetings:manage')) ||
      (await holds(c, 'performance:read'));
    const person = await myPerson(c);
    const scope = c.req.query('scope') === 'all' && everything ? 'all' : 'mine';
    return c.json(
      await transaction(identity.organizationId, async (db) => ({
        scope,
        everything,
        actions:
          scope === 'all'
            ? await readRegister(db)
            : person
              ? await readRegister(db, { personId: person.personId })
              : [],
      })),
    );
  })
  .post('/', gesture('meetings:manage', createAction))
  .post('/:actionId/done', async (c) => {
    const person = await myPerson(c);
    const manages = await holds(c, 'meetings:manage');
    const input = {
      ...((await bodyOf(c)) as object),
      actionId: c.req.param('actionId'),
      actingPersonId: person?.personId ?? null,
      manages,
    };
    return c.json(await refused(runGesture(c, completeAction, input)), 201);
  })
  .post('/:actionId/cancel', gesture('meetings:manage', cancelAction, 'actionId'));
