import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { env } from '../../platform/env.js';
import { findAgent, getTask, personOfAgent, queueTask, type AgentTask } from '../agents/index.js';
import { colleagueCard } from '../directory/index.js';
import { notificationWords, tell } from '../notifications/index.js';
import { readChartAt } from '../structure/index.js';
import { closeTask, putTask, spaceHref } from '../workspace/index.js';
import { awayTo, ruleFor } from './reception.js';

// A request to a colleague (spec 065, doctrine D-044): work asked of a person — never of her
// private agents. It has its states — received, taken, waiting for the one who asked, returned —
// and its thread, where the two people write and her agent, when she hands it the work, says what
// it did. What it prepared comes back only once she signed it: each return says who validated it.

export function requestsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.colleague_requests (
  organization_id text not null,
  request_id text not null,
  from_user_id text not null,
  from_name text not null check (length(from_name) between 1 and 200),
  to_user_id text not null,
  to_name text not null check (length(to_name) between 1 and 200),
  title text not null check (length(title) between 1 and 200),
  detail text not null default '' check (length(detail) <= 4000),
  due_on date,
  status text not null
    check (status in ('received', 'taken', 'waiting', 'returned', 'declined', 'cancelled')),
  -- Her agent, when she handed it the work, and its task.
  agent_id text,
  agent_task_id text,
  returned_text text check (length(returned_text) <= 8000),
  -- Who signed the return: always the person asked; whether her agent prepared it.
  signed_by text,
  signed_at timestamptz,
  prepared_by_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, request_id)
);
create index colleague_requests_to on ${s}.colleague_requests (organization_id, to_user_id, updated_at desc);
create index colleague_requests_from on ${s}.colleague_requests (organization_id, from_user_id, updated_at desc);
${policy('colleague_requests')}
grant select, insert, update on ${s}.colleague_requests to ${options.appRole};

-- The request's thread: what each one wrote or did, in order. Written once.
create table ${s}.colleague_request_events (
  organization_id text not null,
  event_id text not null,
  request_id text not null,
  kind text not null check (kind in
    ('asked', 'taken', 'handed', 'waiting', 'answered', 'note', 'returned', 'declined', 'cancelled', 'reminded')),
  actor_kind text not null check (actor_kind in ('person', 'agent')),
  actor_id text not null,
  actor_name text not null check (length(actor_name) between 1 and 200),
  text text not null default '' check (length(text) <= 8000),
  at timestamptz not null default now(),
  primary key (organization_id, event_id),
  foreign key (organization_id, request_id)
    references ${s}.colleague_requests (organization_id, request_id) on delete cascade
);
create index colleague_request_events_request
  on ${s}.colleague_request_events (organization_id, request_id, at);
${policy('colleague_request_events')}
grant select, insert on ${s}.colleague_request_events to ${options.appRole};
revoke update, delete on ${s}.colleague_request_events from ${options.appRole};
`;
}

export type RequestStatus =
  'received' | 'taken' | 'waiting' | 'returned' | 'declined' | 'cancelled';

export interface RequestEvent {
  kind:
    | 'asked'
    | 'taken'
    | 'handed'
    | 'waiting'
    | 'answered'
    | 'note'
    | 'returned'
    | 'declined'
    | 'cancelled'
    | 'reminded'
    | 'agent_done';
  actor: { kind: 'person' | 'agent'; id: string; name: string };
  text: string;
  at: string;
}

export interface ColleagueRequest {
  requestId: string;
  from: { userId: string; name: string };
  to: { userId: string; name: string };
  title: string;
  detail: string;
  dueOn: string | null;
  status: RequestStatus;
  agent: { agentId: string; name: string; work: AgentTask['status'] | null } | null;
  returned: {
    text: string;
    signedBy: string;
    signedAt: string;
    /** The agent that prepared it, when one did: she signed it all the same. */
    preparedBy: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export class RequestRefusal extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'herself'
      | 'ambiguous'
      | 'not_hers'
      | 'not_possible'
      | 'not_her_agent'
      | 'too_soon',
  ) {
    super(reason);
    this.name = 'RequestRefusal';
  }
}

type Who = {
  organizationId: string;
  userId: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | null;
};

type Row = {
  request_id: string;
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  title: string;
  detail: string;
  due_on: string | null;
  status: RequestStatus;
  agent_id: string | null;
  agent_task_id: string | null;
  returned_text: string | null;
  signed_by: string | null;
  signed_at: Date | null;
  prepared_by_agent: string | null;
  created_at: Date;
  updated_at: Date;
};

const columns = `request_id, from_user_id, from_name, to_user_id, to_name, title, detail,
  to_char(due_on, 'YYYY-MM-DD') as due_on, status, agent_id, agent_task_id, returned_text,
  signed_by, signed_at, prepared_by_agent, created_at, updated_at`;

async function requestOf(db: SqlExecutor, row: Row): Promise<ColleagueRequest> {
  let agent: ColleagueRequest['agent'] = null;
  if (row.agent_id) {
    const found = await findAgent(db, row.agent_id);
    const task = row.agent_task_id ? await getTask(db, row.agent_task_id) : null;
    agent = {
      agentId: row.agent_id,
      name: found?.name ?? row.agent_id,
      work: task?.status ?? null,
    };
  }
  return {
    requestId: row.request_id,
    from: { userId: row.from_user_id, name: row.from_name },
    to: { userId: row.to_user_id, name: row.to_name },
    title: row.title,
    detail: row.detail,
    dueOn: row.due_on,
    status: row.status,
    agent,
    returned:
      row.returned_text !== null && row.signed_by && row.signed_at
        ? {
            text: row.returned_text,
            signedBy: row.signed_by,
            signedAt: row.signed_at.toISOString(),
            preparedBy: row.prepared_by_agent,
          }
        : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function find(db: SqlExecutor, requestId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(
    `select ${columns} from colleague_requests where request_id = $1 for update`,
    [requestId],
  );
  return rows[0] ?? null;
}

async function note(
  db: SqlExecutor,
  organizationId: string,
  requestId: string,
  kind: Exclude<RequestEvent['kind'], 'agent_done'>,
  actor: RequestEvent['actor'],
  text = '',
) {
  await db.query(
    `insert into colleague_request_events
       (organization_id, event_id, request_id, kind, actor_kind, actor_id, actor_name, text)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      organizationId,
      newId('rqe'),
      requestId,
      kind,
      actor.kind,
      actor.id,
      actor.name,
      text.slice(0, 8000),
    ],
  );
  await db.query(`update colleague_requests set updated_at = now() where request_id = $1`, [
    requestId,
  ]);
}

const person = (who: Who): RequestEvent['actor'] => ({
  kind: 'person',
  id: who.userId,
  name: who.name || who.userId,
});
const href = (requestId: string) => `/demandes/${requestId}`;

/** The colleague a name or an account points to, as the directory shows her to the asker. */
export async function colleagueOf(db: SqlExecutor, who: Who, wanted: string) {
  const chart = await readChartAt(db, new Date().toISOString().slice(0, 10));
  const known = chart.people.filter((p) => p.accountUserId);
  const text = wanted.trim().toLowerCase();
  const exact = known.filter(
    (p) => p.accountUserId === wanted.trim() || p.personId === wanted.trim(),
  );
  const named = exact.length ? exact : known.filter((p) => p.name.trim().toLowerCase() === text);
  const close = named.length
    ? named
    : known.filter((p) => p.name.toLowerCase().split(/\s+/).includes(text));
  if (close.length > 1) throw new RequestRefusal('ambiguous');
  const userId = close[0]?.accountUserId;
  if (!userId) throw new RequestRefusal('not_found');
  if (userId === who.userId) throw new RequestRefusal('herself');
  const card = await colleagueCard(db, who, userId);
  if (!card) throw new RequestRefusal('not_found');
  return { userId, name: card.name };
}

/** She asks a colleague for a piece of work: it arrives in the colleague's « À faire ». */
export async function askColleague(
  db: SqlExecutor,
  who: Who,
  input: {
    colleague: string;
    title: string;
    detail?: string | undefined;
    dueOn?: string | null | undefined;
  },
): Promise<ColleagueRequest> {
  const asked = await colleagueOf(db, who, input.colleague);
  // « Mon accueil » (spec 067): away, her requests go to the colleague she named — once, never
  // back to who asks.
  const away = await awayTo(db, asked.userId);
  const to = away && away.delegate.userId !== who.userId ? away.delegate : asked;
  const requestId = newId('rqt');
  const { rows } = await db.query<Row>(
    `insert into colleague_requests (organization_id, request_id, from_user_id, from_name,
       to_user_id, to_name, title, detail, due_on, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received') returning ${columns}`,
    [
      who.organizationId,
      requestId,
      who.userId,
      who.name || who.userId,
      to.userId,
      to.name,
      input.title,
      input.detail ?? '',
      input.dueOn ?? null,
    ],
  );
  await note(db, who.organizationId, requestId, 'asked', person(who), input.detail ?? '');
  if (to.userId !== asked.userId && away) {
    await note(
      db,
      who.organizationId,
      requestId,
      'note',
      { kind: 'person', id: asked.userId, name: asked.name },
      notificationWords().receptionAway(to.name, away.endsOn),
    );
  }
  const title = notificationWords().requestReceived(who.name || who.userId, input.title);
  await putTask(db, who.organizationId, to.userId, {
    source: 'requests',
    key: requestId,
    title: title.slice(0, 300),
    href: spaceHref(env.publicWebUrl, href(requestId)),
    ...(input.dueOn ? { dueAt: `${input.dueOn}T17:00:00Z` } : {}),
  });
  await tell(db, who.organizationId, to.userId, {
    kind: 'request.received',
    title,
    href: href(requestId),
  });
  // A rule of hers hands it to her own agent, which prepares: she still signs what goes back.
  const rule = await ruleFor(db, to.userId, `${input.title} ${input.detail ?? ''}`);
  if (rule) {
    return moveRequest(
      db,
      { organizationId: who.organizationId, userId: to.userId, name: to.name, role: null },
      requestId,
      { kind: 'hand', agentId: rule.agent.agentId, byRule: rule.word },
    );
  }
  return requestOf(db, rows[0] as Row);
}

/** Her requests: those she sent, and those she received. */
export async function requestsOf(
  db: SqlExecutor,
  userId: string,
): Promise<{ sent: ColleagueRequest[]; received: ColleagueRequest[] }> {
  const { rows } = await db.query<Row>(
    `select ${columns} from colleague_requests
      where from_user_id = $1 or to_user_id = $1 order by updated_at desc limit 100`,
    [userId],
  );
  const all = await Promise.all(rows.map((row) => requestOf(db, row)));
  return {
    sent: all.filter((request) => request.from.userId === userId),
    received: all.filter((request) => request.to.userId === userId),
  };
}

/** One request with its thread, for one of its two people; null for anyone else. */
export async function readRequest(
  db: SqlExecutor,
  userId: string,
  requestId: string,
): Promise<(ColleagueRequest & { events: RequestEvent[] }) | null> {
  const { rows } = await db.query<Row>(
    `select ${columns} from colleague_requests where request_id = $1`,
    [requestId],
  );
  const row = rows[0];
  if (!row || (row.from_user_id !== userId && row.to_user_id !== userId)) return null;
  const request = await requestOf(db, row);
  const { rows: events } = await db.query<{
    kind: RequestEvent['kind'];
    actor_kind: 'person' | 'agent';
    actor_id: string;
    actor_name: string;
    text: string;
    at: Date;
  }>(
    `select kind, actor_kind, actor_id, actor_name, text, at from colleague_request_events
      where request_id = $1 order by at, event_id`,
    [requestId],
  );
  const thread: RequestEvent[] = events.map((event) => ({
    kind: event.kind,
    actor: { kind: event.actor_kind, id: event.actor_id, name: event.actor_name },
    text: event.text,
    at: event.at.toISOString(),
  }));
  // What her agent did, said in the thread once its work is done. Who asked sees that an agent
  // worked, never the receiver's own arrangements beyond it.
  if (row.agent_task_id && row.agent_id) {
    const task = await getTask(db, row.agent_task_id);
    if (task && task.status !== 'queued' && task.status !== 'running') {
      const own = row.to_user_id === userId;
      thread.push({
        kind: 'agent_done',
        actor: { kind: 'agent', id: row.agent_id, name: request.agent?.name ?? row.agent_id },
        text: own ? (task.answer ?? task.error ?? '') : '',
        at: task.finishedAt ?? task.createdAt,
      });
      thread.sort((a, b) => a.at.localeCompare(b.at));
    }
  }
  return { ...request, events: thread };
}

type Move =
  | { kind: 'take' }
  | { kind: 'hand'; agentId: string; byRule?: string }
  | { kind: 'wait'; question: string }
  | { kind: 'answer'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'return'; text: string }
  | { kind: 'decline'; reason: string }
  | { kind: 'cancel' }
  | { kind: 'remind' };

/** What each of the two may do, and in which state. */
const allowed: Record<Move['kind'], { by: 'from' | 'to' | 'both'; from: RequestStatus[] }> = {
  take: { by: 'to', from: ['received'] },
  hand: { by: 'to', from: ['received', 'taken'] },
  wait: { by: 'to', from: ['received', 'taken'] },
  answer: { by: 'from', from: ['waiting'] },
  note: { by: 'both', from: ['received', 'taken', 'waiting'] },
  return: { by: 'to', from: ['received', 'taken', 'waiting'] },
  decline: { by: 'to', from: ['received', 'taken', 'waiting'] },
  cancel: { by: 'from', from: ['received', 'taken', 'waiting'] },
  remind: { by: 'from', from: ['received', 'taken'] },
};

/**
 * A move on a request, by one of its two people: she takes it, hands it to her agent, asks back,
 * returns it signed, declines it; he answers, writes, reminds, cancels. The other is told.
 */
export async function moveRequest(
  db: SqlExecutor,
  who: Who,
  requestId: string,
  move: Move,
): Promise<ColleagueRequest> {
  const row = await find(db, requestId);
  if (!row) throw new RequestRefusal('not_found');
  const role =
    row.to_user_id === who.userId ? 'to' : row.from_user_id === who.userId ? 'from' : null;
  if (!role) throw new RequestRefusal('not_found');
  const rule = allowed[move.kind];
  if (rule.by !== 'both' && rule.by !== role) throw new RequestRefusal('not_hers');
  if (!rule.from.includes(row.status)) throw new RequestRefusal('not_possible');
  const words = notificationWords();
  const other = role === 'to' ? row.from_user_id : row.to_user_id;
  const me = person(who);
  const set = async (sql: string, values: unknown[]) =>
    db.query(`update colleague_requests set ${sql}, updated_at = now() where request_id = $1`, [
      requestId,
      ...values,
    ]);

  switch (move.kind) {
    case 'take':
      await set(`status = 'taken'`, []);
      await note(db, who.organizationId, requestId, 'taken', me);
      await tell(db, who.organizationId, other, {
        kind: 'request.taken',
        title: words.requestTaken(row.to_name, row.title),
        href: href(requestId),
      });
      break;
    case 'hand': {
      // Only her own agent, acting for her: never more than her rights.
      const agent = await findAgent(db, move.agentId);
      if (!agent || agent.status !== 'active' || (await personOfAgent(db, agent)) !== who.userId) {
        throw new RequestRefusal('not_her_agent');
      }
      const task = await queueTask(db, {
        organizationId: who.organizationId,
        agentId: agent.agentId,
        givenBy: who.userId,
        instruction: [
          `Prépare la réponse à la demande de ${row.from_name} : « ${row.title} ».`,
          row.detail ? `Ce qu'elle précise : ${row.detail}` : '',
          row.due_on ? `Pour le ${row.due_on}.` : '',
          'Ta réponse sera relue et signée par la personne pour qui tu travailles avant de partir.',
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 4000),
      });
      await set(`status = 'taken', agent_id = $2, agent_task_id = $3`, [
        agent.agentId,
        task.taskId,
      ]);
      await note(
        db,
        who.organizationId,
        requestId,
        'handed',
        me,
        move.byRule ? words.receptionHanded(agent.name, move.byRule) : agent.name,
      );
      break;
    }
    case 'wait':
      await set(`status = 'waiting'`, []);
      await note(db, who.organizationId, requestId, 'waiting', me, move.question);
      await putTask(db, who.organizationId, other, {
        source: 'requests',
        key: `${requestId}:waiting`,
        title: words.requestWaiting(row.to_name, row.title).slice(0, 300),
        href: spaceHref(env.publicWebUrl, href(requestId)),
      });
      await tell(db, who.organizationId, other, {
        kind: 'request.waiting',
        title: words.requestWaiting(row.to_name, row.title),
        href: href(requestId),
      });
      break;
    case 'answer':
      await set(`status = 'taken'`, []);
      await closeTask(db, who.userId, { source: 'requests', key: `${requestId}:waiting` });
      await note(db, who.organizationId, requestId, 'answered', me, move.text);
      await tell(db, who.organizationId, other, {
        kind: 'request.answered',
        title: words.requestAnswered(row.from_name, row.title),
        href: href(requestId),
      });
      break;
    case 'note':
      await note(db, who.organizationId, requestId, 'note', me, move.text);
      break;
    case 'return': {
      // She signs what goes back — written by her, or prepared by her agent and read by her.
      const task = row.agent_task_id ? await getTask(db, row.agent_task_id) : null;
      const prepared = task?.status === 'done' && row.agent_id ? row.agent_id : null;
      await set(
        `status = 'returned', returned_text = $2, signed_by = $3, signed_at = now(), prepared_by_agent = $4`,
        [move.text, who.userId, prepared],
      );
      await note(db, who.organizationId, requestId, 'returned', me, move.text);
      await closeTask(db, who.userId, { source: 'requests', key: requestId });
      await tell(db, who.organizationId, other, {
        kind: 'request.returned',
        title: words.requestReturned(row.to_name, row.title),
        href: href(requestId),
      });
      break;
    }
    case 'decline':
      await set(`status = 'declined'`, []);
      await note(db, who.organizationId, requestId, 'declined', me, move.reason);
      await closeTask(db, who.userId, { source: 'requests', key: requestId });
      await tell(db, who.organizationId, other, {
        kind: 'request.declined',
        title: words.requestDeclined(row.to_name, row.title),
        href: href(requestId),
      });
      break;
    case 'cancel':
      await set(`status = 'cancelled'`, []);
      await note(db, who.organizationId, requestId, 'cancelled', me);
      await closeTask(db, other, { source: 'requests', key: requestId });
      await closeTask(db, who.userId, { source: 'requests', key: `${requestId}:waiting` });
      break;
    case 'remind': {
      // Once a day at most: a reminder is not a flood.
      const { rows } = await db.query(
        `select 1 from colleague_request_events where request_id = $1 and kind = 'reminded'
            and at > now() - interval '1 day'`,
        [requestId],
      );
      if (rows.length > 0) throw new RequestRefusal('too_soon');
      await note(db, who.organizationId, requestId, 'reminded', me);
      await tell(db, who.organizationId, other, {
        kind: 'request.reminded',
        title: words.requestReminded(row.from_name, row.title),
        href: href(requestId),
      });
      break;
    }
  }
  return requestOf(db, (await find(db, requestId)) as Row);
}
