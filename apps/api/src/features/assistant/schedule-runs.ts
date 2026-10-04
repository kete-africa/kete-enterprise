import { ask, BudgetExceededError } from '@kete/ai';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { toolsForPerson } from '../gateway/index.js';
import { queueMail, renderMail } from '../mail/index.js';
import { putTask } from '../workspace/index.js';
import {
  meteringStore,
  modelFor,
  organizationName,
  purposeOf,
  system,
  writeBriefing,
} from './assistant.js';
import { appendMessage, startConversation } from './conversations.js';
import {
  claimSchedule,
  createSchedule,
  listSchedules,
  markScheduleRun,
  removeSchedule,
  scheduleInput,
  ScheduleLimitError,
  schedulesDue,
  setScheduleActive,
  type ScheduleRun,
} from './schedules.js';
import { assistantWords } from './words.js';

// Running a person's scheduled tasks (spec 029): the worker's round every five minutes, or « Run
// now ». Her assistant acts with her rights, never an administrator's; it prepares, she decides.

type Identity = IdentityVariables['identity'];

/** Who the schedule runs for: her, as her token would say — without any administrator's role. */
const identityOf = (s: ScheduleRun): Identity => ({
  userId: s.userId,
  email: s.email,
  name: s.name,
  organizationId: s.organizationId,
  role: null,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 15 * 60_000),
});

const link = (path: string) => (env.publicWebUrl ? `${env.publicWebUrl}${path}` : null);

/** Her question answered with her rights; the answer kept as a conversation of hers. */
async function answerQuestion(s: ScheduleRun): Promise<{
  status: 'done' | 'failed' | 'no_model';
  conversationId: string | null;
  text: string;
}> {
  const identity = identityOf(s);
  const choice = await modelFor(identity);
  if (!choice) return { status: 'no_model', conversationId: null, text: '' };
  const organization = await transaction(s.organizationId, organizationName);
  let text = '';
  let status: 'done' | 'failed' = 'done';
  try {
    const answer = await asPerson(identity, async () =>
      ask({
        model: choice.model,
        system: `${system(organization, s.name)}\nC’est une tâche planifiée « ${s.title} » : réponds directement, elle lira ta réponse plus tard.`,
        prompt: s.prompt ?? s.title,
        tools: await toolsForPerson(identity),
        maxSteps: 6,
        metering: {
          store: meteringStore(choice.personal),
          context: {
            organizationId: s.organizationId,
            actor: {
              kind: 'agent',
              id: 'agt_assistant',
              channel: 'worker',
              onBehalfOf: { kind: 'person', id: s.userId },
            },
            purpose: purposeOf('schedule', choice.personal),
            model: '',
          },
        },
      }),
    );
    text = answer.text.trim();
    if (!text) status = 'failed';
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) {
      console.error('[schedule]', (error as Error).message);
    }
    status = 'failed';
  }
  const w = assistantWords(s.locale);
  const conversationId = await transaction(s.organizationId, async (db) => {
    const id = await startConversation(db, s.organizationId, s.userId, s.title);
    await appendMessage(db, s.organizationId, id, { role: 'user', content: s.prompt ?? s.title });
    await appendMessage(db, s.organizationId, id, {
      role: 'assistant',
      content: status === 'done' ? text : w.taskFailed,
    });
    return id;
  });
  return { status, conversationId, text };
}

/** Runs one schedule taken by the worker or by her « Run now ». */
export async function runSchedule(s: ScheduleRun): Promise<'done' | 'failed' | 'no_model'> {
  const w = assistantWords(s.locale);
  const day = new Date().toISOString().slice(0, 10);
  let status: 'done' | 'failed' | 'no_model' = 'done';
  let mail: {
    subject: string;
    paragraphs: string[];
    action: { label: string; url: string } | null;
  };
  if (s.kind === 'briefing') {
    // Her briefing of the day, written again now: on her home page, and in her mailbox if asked.
    const briefing = await writeBriefing(identityOf(s), true);
    const url = link('/');
    mail = {
      subject: w.briefingSubject,
      paragraphs: briefing.text.split('\n').filter((line) => line.trim()),
      action: url ? { label: w.briefingAction, url } : null,
    };
  } else {
    const answer = await answerQuestion(s);
    status = answer.status;
    const url = answer.conversationId ? link(`/assistant?c=${answer.conversationId}`) : null;
    // The answer waits in her « To do », one per schedule and day.
    if (url) {
      await transaction(s.organizationId, (db) =>
        putTask(db, s.organizationId, s.userId, {
          source: 'assistant',
          key: `${s.scheduleId}-${day}`,
          title: s.title,
          href: url,
        }),
      );
    }
    mail = {
      subject: w.taskSubject(s.title),
      paragraphs:
        answer.status === 'done'
          ? answer.text.split('\n').filter((line) => line.trim())
          : [w.taskFailed],
      action: url ? { label: w.taskAction, url } : null,
    };
  }
  await transaction(s.organizationId, async (db) => {
    if (s.byEmail && status !== 'no_model') {
      const rendered = renderMail({
        locale: s.locale,
        sender: await organizationName(db),
        greeting: w.greeting(s.name),
        paragraphs: mail.paragraphs.slice(0, 60),
        ...(mail.action ? { action: mail.action } : {}),
        reason: w.reason,
      });
      await queueMail(db, s.organizationId, {
        to: s.email,
        subject: mail.subject,
        ...rendered,
        purpose: s.kind === 'briefing' ? 'assistant.briefing' : 'assistant.schedule',
      });
    }
    await markScheduleRun(db, s.scheduleId, status);
  });
  return status;
}

/** The worker's round: every schedule due, each taken once, one failure never stopping the rest. */
export async function runDueSchedules(): Promise<number> {
  let ran = 0;
  for (const { organizationId, scheduleId } of await schedulesDue(getPool())) {
    try {
      const taken = await transaction(organizationId, (db) =>
        claimSchedule(db, scheduleId, { due: true }),
      );
      if (!taken) continue;
      await runSchedule(taken);
      ran += 1;
    } catch (error) {
      console.error(`schedule ${scheduleId} could not run`, error);
    }
  }
  return ran;
}

type Ctx = Context<{ Variables: IdentityVariables }>;

/** Her scheduled tasks are hers to set: never while an administrator views her space. */
function herself(c: Ctx): void {
  if (c.get('viewedBy')) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only the person sets her own tasks.');
  }
}

const isSchedule = z.string().regex(/^sch_[0-9A-Za-z_-]{4,64}$/);

/** Her scheduled tasks, under /v1/assistant/schedules (spec 029). */
export const scheduleRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({
      schedules: await transaction(organizationId, (db) => listSchedules(db, userId)),
    });
  })
  .post('/', async (c) => {
    herself(c);
    const parsed = scheduleInput.safeParse(await bodyOf(c));
    if (!parsed.success) {
      throw new GestureRefusal(422, 'invalid_input', 'A title, a time, a cadence.');
    }
    const identity = c.get('identity');
    try {
      const schedule = await transaction(identity.organizationId, (db) =>
        createSchedule(db, identity, parsed.data),
      );
      return c.json({ schedule }, 201);
    } catch (error) {
      if (error instanceof ScheduleLimitError) {
        throw new GestureRefusal(409, 'too_many_schedules', 'Twenty scheduled tasks at most.');
      }
      throw error;
    }
  })
  .post('/:scheduleId/active', async (c) => {
    herself(c);
    const id = isSchedule.safeParse(c.req.param('scheduleId'));
    const active = z.object({ active: z.boolean() }).safeParse(await bodyOf(c));
    if (!id.success || !active.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Which task, on or off?');
    }
    const { organizationId, userId } = c.get('identity');
    const schedule = await transaction(organizationId, (db) =>
      setScheduleActive(db, userId, id.data, active.data.active),
    );
    if (!schedule) throw new GestureRefusal(404, 'not_found', 'No such task.');
    return c.json({ schedule }, 201);
  })
  .post('/:scheduleId/run', async (c) => {
    herself(c);
    const id = isSchedule.safeParse(c.req.param('scheduleId'));
    if (!id.success) throw new GestureRefusal(422, 'invalid_input', 'Which task?');
    const { organizationId, userId } = c.get('identity');
    const taken = await transaction(organizationId, (db) =>
      claimSchedule(db, id.data, { userId, due: false }),
    );
    if (!taken) throw new GestureRefusal(404, 'not_found', 'No such task.');
    return c.json({ status: await runSchedule(taken) }, 201);
  })
  .post('/:scheduleId/remove', async (c) => {
    herself(c);
    const id = isSchedule.safeParse(c.req.param('scheduleId'));
    if (!id.success) throw new GestureRefusal(422, 'invalid_input', 'Which task?');
    const { organizationId, userId } = c.get('identity');
    const removed = await transaction(organizationId, (db) => removeSchedule(db, userId, id.data));
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such task.');
    return c.json({ removed: true });
  });
