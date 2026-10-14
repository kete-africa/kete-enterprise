import { understand, type GestureOffer } from '@kete/ai';
import {
  applySet,
  dismissSet,
  getProposalSet,
  proposeSet,
  undoSet,
  type ProposalItem,
  type StoredProposalSet,
} from '@kete/drafts';
import type { ProposalSet } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import type { LanguageModel } from 'ai';
import { env } from '../../platform/env.js';
import { organizationLanguageModel } from '../../platform/models.js';
import { usageStore } from '../../platform/usage.js';
import { closeTask, openTasksOf, putTask, spaceHref, type AppTask } from '../workspace/index.js';

// The evening's closure (spec 083, doctrine D-051): she writes or says what her day was; the
// assistant proposes gestures on her open To do — close what is done, move what slips, a reminder
// for a day she names — never on what she does not have. She ticks them, applies them together,
// and may undo them together. Every gesture here is reversible (level 2, or 1 for a reminder).

let modelOverride: LanguageModel | null | undefined;

/** Tests: a scripted model, or none (`null`); `undefined` goes back to the organization's. */
export function useClosureModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

/** Lomé's time is UTC all year: a reminder « jeudi » is at 9 h, Lomé. */
const REMIND_AT = 'T09:00:00Z';

const offers: GestureOffer[] = [
  {
    gesture: 'close',
    describe: 'take out of her To do a task she says is done',
    level: 2,
    capability: 'todo_close',
    inputOf: ({ object }) => ({ taskId: object?.key }),
  },
  {
    gesture: 'postpone',
    describe: 'move a task of her To do to the day she names',
    level: 2,
    capability: 'todo_move',
    inputOf: ({ object, day }) => ({ taskId: object?.key, day }),
  },
  {
    gesture: 'remind',
    describe: 'remind her of something on the day she names (needs a day)',
    level: 1,
    capability: 'todo_remind',
    needsObject: false,
    inputOf: ({ day, text }) => ({ day, title: text }),
  },
];

export interface Person {
  organizationId: string;
  userId: string;
}

export type Understood =
  | { status: 'not_connected' }
  | { status: 'nothing'; unclear: string[] }
  | { status: 'proposed'; set: StoredProposalSet; unclear: string[] };

/** What her note proposes on her open To do; kept for her to decide. */
export async function understandEvening(
  db: SqlExecutor,
  person: Person,
  text: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<Understood> {
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) return { status: 'not_connected' };
  const tasks = await openTasksOf(db, person.userId);
  const { items, unclear } = await understand({
    model,
    text,
    today,
    language: 'French',
    known: tasks.map((task) => ({
      key: task.taskId,
      kind: 'task',
      label: task.title,
      ...(task.dueAt ? { due: task.dueAt.slice(0, 10) } : {}),
    })),
    offers,
    metering: {
      store: usageStore(),
      context: {
        organizationId: person.organizationId,
        actor: {
          kind: 'agent',
          id: 'agt_assistant',
          channel: 'web',
          onBehalfOf: { kind: 'person', id: person.userId },
        },
        purpose: 'evening-closure',
        model: '',
      },
    },
  });
  // A move or a reminder without its day is not a gesture: left out.
  const kept = items.filter(
    (item) => item.gesture === 'close' || typeof item.input?.['day'] === 'string',
  );
  if (kept.length === 0) return { status: 'nothing', unclear };
  const set = await proposeSet(db, person.organizationId, {
    origin: 'closure',
    for: person.userId,
    items: kept as ProposalSet['items'],
  });
  return { status: 'proposed', set, unclear };
}

/** Her set, or nothing: another person's set is not hers to decide. */
async function hers(db: SqlExecutor, person: Person, id: string) {
  const stored = await getProposalSet(db, id);
  return stored?.set.for === person.userId ? stored : null;
}

const taskOf = (tasks: AppTask[], id: unknown) => tasks.find((task) => task.taskId === id);
const actor = (person: Person) => ({
  kind: 'person' as const,
  id: person.userId,
  channel: 'web' as const,
});

/** What applying a gesture changed, kept to undo it. */
type Applied =
  | {
      gesture: 'close';
      task: { source: string; key: string; title: string; href: string; dueAt: string | null };
    }
  | {
      gesture: 'postpone';
      task: { source: string; key: string; title: string; href: string; dueAt: string | null };
    }
  | { gesture: 'remind'; key: string };

/** Applies what she ticked, together; a task she no longer has fails, the others go on. */
export async function applyEvening(
  db: SqlExecutor,
  person: Person,
  id: string,
  ticked: readonly string[],
): Promise<StoredProposalSet | null> {
  if (!(await hers(db, person, id))) return null;
  const tasks = await openTasksOf(db, person.userId);
  const keyOf = async (taskId: string) => {
    const { rows } = await db.query<{ source: string; key: string }>(
      `select source, key from app_tasks where task_id = $1 and user_id = $2`,
      [taskId, person.userId],
    );
    return rows[0] ?? null;
  };
  return applySet(db, id, {
    by: actor(person),
    ticked,
    apply: async (item: ProposalItem) => {
      const input = item.input ?? {};
      if (item.gesture === 'remind') {
        const key = `${id}:${item.key}`;
        await putTask(db, person.organizationId, person.userId, {
          source: 'closure',
          key,
          title: String(input['title']),
          href: spaceHref(env.publicWebUrl, '/'),
          dueAt: `${String(input['day'])}${REMIND_AT}`,
        });
        return { ok: true, result: { gesture: 'remind', key } satisfies Applied };
      }
      const task = taskOf(tasks, input['taskId']);
      const ref = task ? await keyOf(task.taskId) : null;
      if (!task || !ref) return { ok: false, reason: 'not_found' };
      const before = { ...ref, title: task.title, href: task.href, dueAt: task.dueAt };
      if (item.gesture === 'close') {
        await closeTask(db, person.userId, ref);
        return { ok: true, result: { gesture: 'close', task: before } satisfies Applied };
      }
      await putTask(db, person.organizationId, person.userId, {
        ...ref,
        title: task.title,
        href: task.href,
        dueAt: `${String(input['day'])}${REMIND_AT}`,
      });
      return { ok: true, result: { gesture: 'postpone', task: before } satisfies Applied };
    },
  });
}

/** Undoes what was applied, the last first: a task back as it was, a reminder taken out. */
export async function undoEvening(
  db: SqlExecutor,
  person: Person,
  id: string,
): Promise<StoredProposalSet | null> {
  if (!(await hers(db, person, id))) return null;
  return undoSet(db, id, {
    by: actor(person),
    undo: async (_item, result) => {
      const applied = result as Applied | undefined;
      if (!applied) return false;
      if (applied.gesture === 'remind') {
        return closeTask(db, person.userId, { source: 'closure', key: applied.key });
      }
      const { dueAt, ...task } = applied.task;
      await putTask(db, person.organizationId, person.userId, {
        ...task,
        ...(dueAt ? { dueAt } : {}),
      });
      return true;
    },
  });
}

/** She keeps none of it. */
export async function dismissEvening(
  db: SqlExecutor,
  person: Person,
  id: string,
): Promise<StoredProposalSet | null> {
  if (!(await hers(db, person, id))) return null;
  return dismissSet(db, id, actor(person));
}
