import type { CommandDefinition } from '@kete/commands';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import {
  actorOf,
  bodyOf,
  GestureRefusal,
  runCommand,
  runGesture,
} from '../../platform/gestures.js';
import { usageStore } from '../../platform/usage.js';
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
import {
  keepProposal,
  proposeRecord,
  readTranscript,
  RecordError,
  saveTranscript,
  transcribeAudio,
} from './records.js';

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

/** At most 25 MB a recording (what the transcription models take). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** The meeting of the request, for a person who runs meetings. */
async function managed(c: Ctx) {
  if (!(await holds(c, 'meetings:manage'))) {
    throw new GestureRefusal(403, 'forbidden', 'This needs « meetings:manage ».');
  }
  if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to run.');
  const { organizationId } = c.get('identity');
  const [meeting] = await transaction(organizationId, (db) =>
    listMeetings(db, c.req.param('meetingId')),
  );
  if (!meeting) throw new GestureRefusal(404, 'not_found', 'No such meeting.');
  return meeting;
}

/** The use of the models for a meeting's record, journaled as the person's. */
function meteringOf(c: Ctx) {
  const { organizationId, userId } = c.get('identity');
  return {
    store: usageStore(),
    context: {
      organizationId,
      actor: { kind: 'person' as const, id: userId, channel: 'web' as const },
      purpose: 'meetings',
      model: '',
    },
  };
}

/** A model's refusal, said to the screen. */
async function recorded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof RecordError) throw new GestureRefusal(409, error.code, error.message);
    throw error;
  }
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
  // Its transcript (spec 035): an audio recording transcribed and not kept, or a text pasted.
  .get('/meetings/:meetingId/transcript', async (c) => {
    const meeting = await managed(c);
    const { organizationId } = c.get('identity');
    return c.json({
      transcript: await transaction(organizationId, (db) => readTranscript(db, meeting.meetingId)),
    });
  })
  .post('/meetings/:meetingId/transcript', async (c) => {
    const meeting = await managed(c);
    const parsed = z
      .union([
        z.object({ text: z.string().trim().min(1).max(400_000) }),
        z.object({
          audio: z
            .string()
            .min(1)
            .max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8),
          contentType: z.string().regex(/^audio\/[\w.+-]+$/),
        }),
      ])
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A text or a recording.');
    const identity = c.get('identity');
    let read: { text: string; language: string | null; source: 'audio' | 'text' };
    if ('text' in parsed.data) {
      read = { text: parsed.data.text, language: null, source: 'text' };
    } else {
      const audio = new Uint8Array(Buffer.from(parsed.data.audio, 'base64'));
      if (audio.byteLength > MAX_AUDIO_BYTES) {
        throw new GestureRefusal(422, 'file_too_large', '25 MB at most.');
      }
      read = { ...(await recorded(transcribeAudio(audio, meteringOf(c)))), source: 'audio' };
      if (!read.text) throw new GestureRefusal(422, 'unreadable_file', 'Nothing was heard.');
    }
    await transaction(identity.organizationId, (db) =>
      saveTranscript(db, {
        organizationId: identity.organizationId,
        meetingId: meeting.meetingId,
        ...read,
        by: identity.userId,
      }),
    );
    return c.json({ transcript: { text: read.text, source: read.source } }, 201);
  })
  // The record the model proposes: notes, and decisions with their owner and deadline.
  .post('/meetings/:meetingId/prepare', async (c) => {
    const meeting = await managed(c);
    if (meeting.status !== 'held') {
      throw new GestureRefusal(409, 'wrong_step', 'A record is prepared once the meeting is held.');
    }
    const { organizationId } = c.get('identity');
    const { transcript, people } = await transaction(organizationId, async (db) => ({
      transcript: await readTranscript(db, meeting.meetingId),
      people: (
        await db.query<{ person_id: string; name: string }>(
          `select person_id, name from people where person_id = any($1)`,
          [meeting.presentPersonIds],
        )
      ).rows.map((r) => ({ personId: r.person_id, name: r.name })),
    }));
    if (!transcript) throw new GestureRefusal(409, 'no_transcript', 'No transcript yet.');
    const proposal = await recorded(proposeRecord(meeting, transcript.text, people, meteringOf(c)));
    await transaction(organizationId, (db) => keepProposal(db, meeting.meetingId, proposal));
    return c.json({ proposal }, 201);
  })
  // What the person validated: each decision recorded, then the record published, as hers.
  .post('/meetings/:meetingId/record', async (c) => {
    const meeting = await managed(c);
    const parsed = z
      .object({
        notes: z.string().trim().max(8000).default(''),
        decisions: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(2000),
              responsiblePersonId: z.string().nullable().optional(),
              dueOn: z.string().nullable().optional(),
              idea: z.boolean().default(false),
            }),
          )
          .max(50),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Its notes and decisions.');
    const key = c.req.header('idempotency-key');
    if (!key) throw new GestureRefusal(422, 'idempotency_key_required', 'Send an Idempotency-Key.');
    const { organizationId } = c.get('identity');
    const actor = actorOf(c);
    const decisions = [];
    for (const [index, d] of parsed.data.decisions.entries()) {
      decisions.push(
        await refused(
          runCommand(organizationId, actor, `${key}:decision:${index}`, recordDecision, {
            meetingId: meeting.meetingId,
            text: d.text,
            idea: d.idea,
            ...(d.responsiblePersonId ? { responsiblePersonId: d.responsiblePersonId } : {}),
            ...(d.dueOn ? { dueOn: d.dueOn } : {}),
          }),
        ),
      );
    }
    const published = await refused(
      runCommand(organizationId, actor, `${key}:publish`, publishRecord, {
        meetingId: meeting.meetingId,
        notes: parsed.data.notes,
      }),
    );
    return c.json({ decisions, published }, 201);
  })
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
