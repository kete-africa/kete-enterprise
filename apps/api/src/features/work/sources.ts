import type { Holding as SaidHolding } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { approversNow, currentStep, findRequest, pendingRequestIds } from '../decisions/index.js';

// The center's six sources of « a thing in progress », said as holdings (spec 087, FR-001). Their
// tables stay; each open item is read here and said as a `holding.v1` under its source.

export const APP = 'enterprise';

/** The kinds of the six sources, and where each item opens in the space. */
export const sourceKinds = {
  request: (ref: string) => `/demandes/${ref}`,
  app_task: () => '/a-faire',
  action: () => '/actions',
  circuit_step: (ref: string) => `/a-faire?decision=${ref}`,
  draft: () => '/a-faire',
  agent_task: () => '/mes-agents',
} as const;
export type SourceKind = keyof typeof sourceKinds;

export interface Said extends SaidHolding {
  source: { app: typeof APP; kind: SourceKind; ref: string };
}

/** A day: a DATE is read as its text (`YYYY-MM-DD`), never through a Date at local midnight. */
const day = (value: Date | string) =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
const iso = (value: Date | string) => new Date(value).toISOString();
const person = (id: string) => ({ kind: 'person' as const, id });
const cut = (text: string) => (text.length > 300 ? `${text.slice(0, 299)}…` : text);

function said(
  kind: SourceKind,
  ref: string,
  holding: Omit<Said, 'source' | 'object'> & { object?: Said['object'] },
): Said {
  return {
    source: { app: APP, kind, ref },
    object: holding.object ?? { kind, id: ref },
    ...holding,
    what: cut(holding.what),
  };
}

/** A colleague's request: held by the colleague asked; it waits on the requester she asked back. */
async function requests(db: SqlExecutor): Promise<Said[]> {
  const { rows } = await db.query<{
    request_id: string;
    from_user_id: string;
    to_user_id: string;
    title: string;
    due_on: Date | string | null;
    status: 'received' | 'taken' | 'waiting';
    created_at: Date;
  }>(
    `select request_id, from_user_id, to_user_id, title, to_char(due_on, 'YYYY-MM-DD') as due_on,
            status, created_at
       from colleague_requests where status in ('received', 'taken', 'waiting')`,
  );
  return rows.map((r) =>
    said('request', r.request_id, {
      what: r.title,
      holder: person(r.to_user_id),
      state: r.status === 'waiting' ? 'waiting' : 'held',
      waiting_on: r.status === 'waiting' ? person(r.from_user_id) : null,
      since: iso(r.created_at),
      ...(r.due_on ? { due: day(r.due_on) } : {}),
    }),
  );
}

/**
 * An app's task in « À faire »: held by its person, due on its day. A colleague's request puts its
 * own copy there (source `requests`): the request is already a holding.
 */
async function appTasks(db: SqlExecutor): Promise<Said[]> {
  const { rows } = await db.query<{
    task_id: string;
    user_id: string;
    title: string;
    due_at: Date | null;
    created_at: Date;
  }>(`select task_id, user_id, title, due_at, created_at from app_tasks
      where status = 'open' and source <> 'requests'`);
  return rows.map((r) =>
    said('app_task', r.task_id, {
      what: r.title,
      holder: person(r.user_id),
      state: 'held',
      since: iso(r.created_at),
      ...(r.due_at ? { due: day(r.due_at) } : {}),
    }),
  );
}

/** A meeting's action (or an indicator's, a review's): held by its responsible person. */
async function actions(db: SqlExecutor): Promise<Said[]> {
  const { rows } = await db.query<{
    action_id: string;
    title: string;
    due_on: Date | string;
    created_at: Date;
    holder: string;
  }>(
    `select a.action_id, a.title, to_char(a.due_on, 'YYYY-MM-DD') as due_on, a.created_at,
            coalesce(p.account_user_id, a.responsible_person_id) as holder
       from actions a join people p on p.person_id = a.responsible_person_id
      where a.status = 'open'`,
  );
  return rows.map((r) =>
    said('action', r.action_id, {
      what: r.title,
      holder: person(r.holder),
      state: 'held',
      since: iso(r.created_at),
      due: day(r.due_on),
    }),
  );
}

/**
 * A circuit's current step: held by its first approver today, or — when the step finds nobody —
 * by the organization's head. A request sent back is held by its requester, for its correction.
 */
async function circuitSteps(db: SqlExecutor, head: string | null): Promise<Said[]> {
  const found: Said[] = [];
  for (const requestId of await pendingRequestIds(db)) {
    const request = await findRequest(db, requestId);
    if (!request) continue;
    const step = currentStep(request);
    if (!step) continue;
    let holder: string | null;
    if (request.returned) holder = request.requesterUserId;
    else {
      const approvers = await approversNow(db, request);
      holder = [...(approvers?.people ?? [])].sort()[0] ?? head;
    }
    if (!holder) continue;
    found.push(
      said('circuit_step', requestId, {
        object: { kind: request.subject, id: request.reference },
        what: request.title,
        holder: person(holder),
        state: 'held',
        since: iso(step.enteredAt ?? request.createdAt),
      }),
    );
  }
  return found;
}

/** A draft an agent prepared: held by the person it was prepared for, until she decides. */
async function drafts(db: SqlExecutor): Promise<{ said: Said; forUser: string }[]> {
  const { rows } = await db.query<{
    draft_id: string;
    record_type: string;
    on_behalf_of_id: string;
    created_at: Date;
  }>(
    `select draft_id, record_type, on_behalf_of_id, created_at from kete_drafts
      where status = 'prepared' and on_behalf_of_kind = 'person' and on_behalf_of_id is not null`,
  );
  return rows.map((r) => ({
    said: said('draft', r.draft_id, {
      // Replaced by the draft's own description when the sync knows it (see sync.ts).
      what: r.record_type,
      holder: person(r.on_behalf_of_id),
      state: 'held',
      since: iso(r.created_at),
    }),
    forUser: r.on_behalf_of_id,
  }));
}

/**
 * An agent's task while it is queued or running: held by the person who gave it, the agent its
 * delegate, the result returned to her (doctrine D-061, spec 099, FR-012).
 */
async function agentTasks(db: SqlExecutor): Promise<Said[]> {
  const { rows } = await db.query<{
    task_id: string;
    agent_id: string;
    given_by: string;
    instruction: string;
    created_at: Date;
  }>(
    `select task_id, agent_id, given_by, instruction, created_at from agent_tasks
      where status in ('queued', 'running')`,
  );
  return rows.map((r) =>
    said('agent_task', r.task_id, {
      what: r.instruction,
      holder: { kind: 'person', id: r.given_by },
      delegate: { kind: 'agent', id: r.agent_id },
      return_to: { kind: 'person', id: r.given_by },
      state: 'held',
      since: iso(r.created_at),
    }),
  );
}

/** Every open item of the six sources, as holdings. */
export async function openItems(
  db: SqlExecutor,
  head: string | null,
): Promise<{ items: Said[]; drafts: { said: Said; forUser: string }[] }> {
  // One after the other: one transaction, one connection.
  const items = [
    ...(await requests(db)),
    ...(await appTasks(db)),
    ...(await actions(db)),
    ...(await circuitSteps(db, head)),
    ...(await agentTasks(db)),
  ];
  return { items, drafts: await drafts(db) };
}
