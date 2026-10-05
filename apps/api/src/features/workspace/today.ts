import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { asPerson, type Acting } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import { readRegister } from '../actions/index.js';
import { finishedFor } from '../agents/index.js';
import { pinnedDashboardsFor, type Card, type Dashboard } from '../dashboards/index.js';
import { inboxFor } from '../decisions/index.js';
import { draftsFor, preparedDraftCount } from '../gateway/index.js';
import { listNotes } from '../meetings/index.js';
import { readModules } from '../organization/index.js';
import { personOfAccount } from '../structure/index.js';
import { respondentsOfPerson } from '../surveys/index.js';
import { openTasksOf } from './tasks.js';

// « Aujourd'hui » (spec 046): what waits for the person, as things to do rather than counts — each
// with where it leads; the views she pinned; what her agents finished for her since yesterday.
// Read with her rights. The words are the screens': here only data.

/** One thing to do today. `href` opens it; the screen words it by `kind`. */
export interface DayItem {
  kind: 'decision' | 'draft' | 'app_task' | 'form' | 'action' | 'note';
  id: string;
  title: string;
  /** Where it comes from: an app, a circuit's subject, a meeting, a capability. */
  source: string | null;
  dueAt: string | null;
  overdue: boolean;
  href: string;
  /** A form's progress. */
  progress: { done: number; total: number } | null;
}

export interface DoneItem {
  taskId: string;
  agentName: string;
  instruction: string;
  status: 'done' | 'failed';
  answer: string | null;
  draftCount: number;
  finishedAt: string;
}

export interface Today {
  name: string;
  today: string;
  /** Everything that waits, most pressing first; the screen shows the first ones. */
  day: DayItem[];
  pinned: { dashboard: Dashboard; cards: Card[] }[];
  done: DoneItem[];
}

const rank: Record<DayItem['kind'], number> = {
  decision: 0,
  draft: 1,
  app_task: 2,
  form: 3,
  action: 4,
  note: 5,
};

/** Overdue first, then by kind, then the nearest due date. */
export function ordered(items: DayItem[]): DayItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      rank[a.kind] - rank[b.kind] ||
      (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'),
  );
}

async function waitingIn(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
): Promise<DayItem[]> {
  const modules = await readModules(db);
  const person = await personOfAccount(db, identity.userId);
  const items: DayItem[] = [];
  const inbox = await inboxFor(db, identity);
  for (const r of inbox.toDecide) {
    items.push({
      kind: 'decision',
      id: r.requestId,
      title: r.title,
      source: r.subjectLabel?.fr ?? r.subject,
      dueAt: null,
      overdue: r.overdue,
      href: `/a-faire?item=decision:${r.requestId}`,
      progress: null,
    });
  }
  for (const t of await openTasksOf(db, identity.userId)) {
    items.push({
      kind: 'app_task',
      id: t.taskId,
      title: t.title,
      source: t.source,
      dueAt: t.dueAt,
      overdue: t.overdue,
      href: t.href,
      progress: null,
    });
  }
  if (!person) return items;
  if (modules.surveys) {
    for (const r of await respondentsOfPerson(db, person.personId)) {
      if (r.status === 'submitted') continue;
      items.push({
        kind: 'form',
        id: r.respondentId,
        title: r.title,
        source: r.period,
        dueAt: r.closesOn,
        overdue: r.closesOn < new Date().toISOString().slice(0, 10),
        href: `/enquetes/repondre/${r.respondentId}`,
        progress: { done: r.formsSubmitted, total: r.formsTotal },
      });
    }
  }
  for (const a of await readRegister(db, { personId: person.personId, openOnly: true })) {
    items.push({
      kind: 'action',
      id: a.actionId,
      title: a.title,
      source: a.source,
      dueAt: a.dueOn,
      overdue: a.overdue,
      href: `/a-faire?item=action:${a.actionId}`,
      progress: null,
    });
  }
  if (modules.meetings) {
    for (const n of await listNotes(db, person.personId)) {
      if (n.status !== 'published' || n.readByMe) continue;
      items.push({
        kind: 'note',
        id: n.noteId,
        title: n.subject,
        source: n.number,
        dueAt: null,
        overdue: false,
        href: `/a-faire?item=note:${n.noteId}`,
        progress: null,
      });
    }
  }
  return items;
}

/** The person's « Aujourd'hui ». */
export async function todayFor(
  identity: Acting,
  options: { admin: boolean; viewedBy: string | null },
): Promise<Today> {
  const since = new Date(Date.now() - 86_400_000);
  // Drafts are read through the gateway, as the person: their words come from their capability.
  const drafts = await asPerson(identity, () => draftsFor(identity)).catch(() => []);
  return transaction(identity.organizationId, async (db) => {
    const person = await personOfAccount(db, identity.userId);
    const modules = await readModules(db);
    const items = await waitingIn(db, identity);
    for (const d of drafts) {
      items.push({
        kind: 'draft',
        id: d.draftId,
        title: d.description,
        source: d.capability,
        dueAt: null,
        overdue: false,
        href: `/a-faire?item=draft:${d.draftId}`,
        progress: null,
      });
    }
    return {
      name: person?.name ?? identity.name,
      today: new Date().toISOString().slice(0, 10),
      day: ordered(items),
      pinned: modules.dashboards
        ? await pinnedDashboardsFor(db, identity, { admin: options.admin, limit: 3 })
        : [],
      done: options.viewedBy
        ? []
        : (await finishedFor(db, identity.userId, since)).map((t) => ({
            taskId: t.taskId,
            agentName: t.agentName,
            instruction: t.instruction,
            status: t.status as 'done' | 'failed',
            answer: t.answer,
            draftCount: t.draftIds.length,
            finishedAt: t.finishedAt ?? t.createdAt,
          })),
    };
  });
}

/** How many things wait for her: the count beside « À faire ». */
export async function waitingCount(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
): Promise<number> {
  return (await waitingIn(db, identity)).length + (await preparedDraftCount(db, identity.userId));
}
