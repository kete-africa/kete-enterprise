import { simulatePolicy } from '@kete/policies';
import { newId } from '@kete/records';
import type { Thread } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { joinThread, openThread, postMessage } from '@kete/threads';
import { delegateHolding } from '@kete/work';
import { asPerson } from '../../platform/acting.js';
import { getPool, transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import type { Agent, AgentTask } from '../agents/index.js';
import {
  findAgent,
  getTask,
  personOfAgent,
  queueTask,
  stateOfAgent,
  writeToTask,
} from '../agents/index.js';
import { explainDraft, nextRun } from '../assistant/index.js';
import { decideDraft, reviewDrafts } from '../gateway/index.js';
import { tell } from '../notifications/index.js';
import { readModules } from '../organization/index.js';
import { unitsOfPersonAndAbove } from '../rights/index.js';
import { engine, entitiesFor } from '../policies/index.js';
import { namesOf } from './state.js';
import { messageWords } from './words.js';

// An agent is a colleague (spec 099, FR-013 to FR-016; canvas v6.2, « Les agents »): each agent
// has its own thread with each person who gives it work, where she gives it work by talking. Its
// answers come there, with their steps; what it asks — its drafts — waits under them, answered
// « Autoriser une fois », « Toujours… » (a policy, simulated) or « Refuser »; asked by its routine,
// a request expires after ten minutes and nothing leaves. It takes on her holdings as its job
// description says — never, it proposes, or alone — and the holding stays hers.

type Identity = IdentityVariables['identity'];
type Step = { state: 'done' | 'now' | 'todo' | 'ask'; label: string; tag?: string };

/** What a routine's request is given before it expires: ten minutes (FR-015). */
export const REQUEST_EXPIRES_MS = 10 * 60_000;

export function agentThreadsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const app = options.appRole;
  return `
-- Its job description at work (FR-016, FR-017): what it takes on, what it covers, its computer,
-- whom it returns to, its trial, its routine.
alter table ${s}.agents
  add column take_on jsonb,
  add column covers text[] not null default '{}',
  add column computer_minutes integer check (computer_minutes between 1 and 10000),
  add column return_to text not null default 'giver' check (return_to in ('giver', 'owner')),
  add column trial_until timestamptz,
  add column routine_time text check (routine_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column routine_cadence text check (routine_cadence in ('daily', 'weekdays')),
  add column routine_instruction text check (length(routine_instruction) between 2 and 2000),
  add column next_routine_at timestamptz,
  add constraint agents_routine_whole check (
    (routine_time is null) = (routine_cadence is null)
    and (routine_time is null) = (routine_instruction is null));
alter table ${s}.agent_tasks add column from_routine boolean not null default false;

-- Each agent's thread with each person who gives it work.
create table ${s}.agent_threads (
  organization_id text not null,
  agent_id text not null,
  user_id text not null,
  thread_id text not null unique references ${s}.kete_threads (thread_id),
  primary key (agent_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'agent_threads', appRole: app })}
grant select, insert on ${s}.agent_threads to ${app};

-- Where a task answers, and the holding it works when it took one on.
create table ${s}.agent_task_threads (
  organization_id text not null,
  task_id text primary key,
  thread_id text not null references ${s}.kete_threads (thread_id),
  holding_id text,
  answer_message_id text references ${s}.kete_messages (message_id)
);
create index agent_task_threads_thread on ${s}.agent_task_threads (thread_id);
${organizationPolicySql({ schema: s, table: 'agent_task_threads', appRole: app })}
grant select, insert, update on ${s}.agent_task_threads to ${app};

alter table ${s}.kete_proposals drop constraint kete_proposals_kind_check;
alter table ${s}.kete_proposals add constraint kete_proposals_kind_check
  check (kind in ('gestures', 'policy', 'handover', 'takeon'));

-- The routines due, across organizations: their identifiers only.
create function ${s}.agent_routines_due() returns table (organization_id text, agent_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, agent_id from agents
        where status = 'active' and routine_time is not null
          and (next_routine_at is null or next_routine_at <= now()) $$;
revoke all on function ${s}.agent_routines_due() from public;
grant execute on function ${s}.agent_routines_due() to ${app};
`;
}

/** The agents she may hand work to: those that act for her, and those shared with her. */
export async function agentsOfHers(db: SqlExecutor, identity: Identity): Promise<Agent[]> {
  const { rows } = await db.query<{ agent_id: string }>(
    `select agent_id from agents where status = 'active' order by name`,
  );
  const units = await unitsOfPersonAndAbove(db, identity);
  const hers: Agent[] = [];
  for (const { agent_id } of rows) {
    const agent = await findAgent(db, agent_id);
    if (!agent) continue;
    if ((await personOfAgent(db, agent)) === identity.userId) hers.push(agent);
    else if (
      agent.visibility === 'shared' &&
      (agent.sharedWith.length === 0 || agent.sharedWith.some((u) => units.has(u)))
    ) {
      hers.push(agent);
    }
  }
  return hers;
}

// --- Its thread -----------------------------------------------------------------------------------

/** The agent's thread with this person: opened the first time she gives it work. */
export async function agentThreadOf(
  db: SqlExecutor,
  organizationId: string,
  agent: Pick<Agent, 'agentId' | 'name'>,
  userId: string,
): Promise<string> {
  const { rows } = await db.query<{ thread_id: string }>(
    `select thread_id from agent_threads where agent_id = $1 and user_id = $2`,
    [agent.agentId, userId],
  );
  if (rows[0]) return rows[0].thread_id;
  const thread = await openThread(db, organizationId, {
    kind: 'direct',
    title: agent.name,
    holder: { kind: 'person', id: userId },
    members: [{ kind: 'agent', id: agent.agentId, role: 'member' }],
  });
  await db.query(
    `insert into agent_threads (organization_id, agent_id, user_id, thread_id)
     values ($1, $2, $3, $4)`,
    [organizationId, agent.agentId, userId, thread.id],
  );
  return thread.id;
}

/** The agent a thread belongs to, and whom with; none for any other thread. */
export async function agentOfThread(db: SqlExecutor, threadId: string) {
  const { rows } = await db.query<{ agent_id: string; user_id: string }>(
    `select agent_id, user_id from agent_threads where thread_id = $1`,
    [threadId],
  );
  return rows[0] ? { agentId: rows[0].agent_id, userId: rows[0].user_id } : null;
}

/**
 * Work given to an agent: a task, answered in the thread it was given in — its own thread by
 * default, where her words are posted when they were said elsewhere.
 */
export async function giveToAgent(
  db: SqlExecutor,
  organizationId: string,
  input: {
    agent: Agent;
    givenBy: string;
    instruction: string;
    /** Where it answers: the thread it was asked in; its own by default. */
    threadId?: string;
    /** Her words, posted in its thread (they were said elsewhere). */
    post?: boolean;
    holdingId?: string;
    fromRoutine?: boolean;
  },
): Promise<{ task: AgentTask; threadId: string }> {
  const own = await agentThreadOf(db, organizationId, input.agent, input.givenBy);
  const threadId = input.threadId ?? own;
  if (input.post) {
    await postMessage(db, organizationId, {
      thread: own,
      author: { kind: 'person', id: input.givenBy },
      text: input.instruction.slice(0, 20000),
      for: 'information',
      via: 'kete',
    });
  }
  const task = await queueTask(db, {
    organizationId,
    agentId: input.agent.agentId,
    givenBy: input.givenBy,
    instruction: input.instruction.slice(0, 4000),
    ...(input.fromRoutine ? { fromRoutine: true } : {}),
  });
  await db.query(
    `insert into agent_task_threads (organization_id, task_id, thread_id, holding_id)
     values ($1, $2, $3, $4)`,
    [organizationId, task.taskId, threadId, input.holdingId ?? null],
  );
  return { task, threadId };
}

/** Her words in its thread while it works go to its task: it reads them before its next step. */
export async function speakToAgent(
  db: SqlExecutor,
  identity: Identity,
  threadId: string,
  text: string,
): Promise<string | null> {
  const owner = await agentOfThread(db, threadId);
  if (!owner || owner.userId !== identity.userId) return null;
  const agent = await findAgent(db, owner.agentId);
  if (!agent || agent.status !== 'active') return null;
  const { rows } = await db.query<{ task_id: string }>(
    `select t.task_id from agent_task_threads x join agent_tasks t on t.task_id = x.task_id
      where x.thread_id = $1 and t.status in ('queued', 'running', 'paused')
      order by t.created_at desc limit 1`,
    [threadId],
  );
  const working = rows[0]?.task_id;
  if (working) {
    const written = await writeToTask(
      db,
      working,
      {
        userId: identity.userId,
        name: identity.name || identity.userId,
      },
      text,
    );
    if (written) return working;
  }
  const { task } = await giveToAgent(db, identity.organizationId, {
    agent,
    givenBy: identity.userId,
    instruction: text,
    threadId,
  });
  return task.taskId;
}

const levelWord = (level: number | undefined) => {
  const words = messageWords();
  return (level ?? 1) >= 3 ? words.levelDraft : words.levelRead;
};

/**
 * Its answer, in the thread it was asked in (FR-013, FR-014): what it did, its steps folded under
 * it — a draft is a step that asks —, and to whom it returns when it worked a holding.
 */
export async function agentAnswered(organizationId: string, taskId: string): Promise<void> {
  const words = messageWords();
  await transaction(organizationId, async (db) => {
    const task = await getTask(db, taskId);
    if (!task || task.parentTaskId) return;
    const agent = await findAgent(db, task.agentId);
    if (!agent) return;
    const { rows } = await db.query<{
      thread_id: string;
      holding_id: string | null;
      answer_message_id: string | null;
    }>(
      `select thread_id, holding_id, answer_message_id from agent_task_threads where task_id = $1`,
      [taskId],
    );
    let link = rows[0];
    if (link?.answer_message_id) return;
    if (!link) {
      const threadId = await agentThreadOf(db, organizationId, agent, task.givenBy);
      await db.query(
        `insert into agent_task_threads (organization_id, task_id, thread_id) values ($1, $2, $3)`,
        [organizationId, taskId, threadId],
      );
      link = { thread_id: threadId, holding_id: null, answer_message_id: null };
    }
    const author = { kind: 'agent' as const, id: agent.agentId };
    await joinThread(db, organizationId, link.thread_id, author);
    const text =
      task.status === 'done'
        ? task.answer?.trim() || words.agentDone
        : task.status === 'stopped'
          ? words.agentStopped
          : words.agentFailed(task.error ?? '');
    const posted = await postMessage(db, organizationId, {
      thread: link.thread_id,
      author,
      text: text.slice(0, 20000),
      for: 'information',
      via: 'kete',
      mentions: [{ kind: 'person', id: task.givenBy }],
    });
    const steps: Step[] = task.steps.map((step) => ({
      state: step.status === 'draft' ? 'ask' : step.status === 'refused' ? 'todo' : 'done',
      label: step.tool,
      tag: levelWord(step.level),
    }));
    await db.query(
      `insert into thread_runs (organization_id, message_id, title, steps, seconds)
       values ($1, $2, $3, $4, $5)`,
      [
        organizationId,
        posted.message.id,
        words.agentRun(task.instruction.slice(0, 80)),
        JSON.stringify(steps),
        task.startedAt && task.finishedAt
          ? Math.max(
              0,
              Math.round((Date.parse(task.finishedAt) - Date.parse(task.startedAt)) / 1000),
            )
          : null,
      ],
    );
    await db.query(`update agent_task_threads set answer_message_id = $2 where task_id = $1`, [
      taskId,
      posted.message.id,
    ]);
    // A holding it worked returns, done or not, to whom its job description says.
    if (link.holding_id && task.status === 'done') {
      const owner = await personOfAgent(db, agent);
      const to = agent.returnTo === 'owner' && owner ? owner : task.givenBy;
      await tell(db, organizationId, to, {
        kind: 'agent.task',
        title: words.returnedBy(agent.name),
        href: `/fils?fil=${link.thread_id}`,
      });
    }
  });
}

// --- What it asks ---------------------------------------------------------------------------------

export interface AgentRequest {
  draftId: string;
  capability: string;
  description: string;
  recordType: string;
  status: 'prepared' | 'validated' | 'refused';
  values: Record<string, unknown>;
  display: Record<string, string>;
  /** Asked by its routine: until when it may be allowed (FR-015). */
  expiresAt: string | null;
  expired: boolean;
  /** « Toujours… » is offered: never to sign or to pay. */
  always: boolean;
}

/** The drafts its answers left, under each answer in a thread, as she may decide them. */
export async function agentRequests(
  identity: Identity,
  threadId: string,
): Promise<Record<string, AgentRequest[]>> {
  const links = await transaction(identity.organizationId, async (db) => {
    const { rows } = await db.query<{
      answer_message_id: string;
      draft_ids: string[];
      from_routine: boolean;
    }>(
      `select x.answer_message_id, t.draft_ids, t.from_routine
         from agent_task_threads x join agent_tasks t on t.task_id = x.task_id
        where x.thread_id = $1 and x.answer_message_id is not null
          and cardinality(t.draft_ids) > 0`,
      [threadId],
    );
    const ids = rows.flatMap((r) => r.draft_ids);
    const { rows: drafts } = await db.query<{ draft_id: string; created_at: Date }>(
      `select draft_id, created_at from kete_drafts where draft_id = any($1)`,
      [ids],
    );
    return { rows, created: new Map(drafts.map((d) => [d.draft_id, d.created_at])) };
  });
  if (links.rows.length === 0) return {};
  const reviews = await asPerson(identity, () =>
    reviewDrafts(
      identity,
      links.rows.flatMap((r) => r.draft_ids),
    ),
  );
  const explained = await transaction(identity.organizationId, (db) =>
    Promise.all(reviews.map((review) => explainDraft(db, review))),
  );
  const byId = new Map(explained.map((r) => [r.draftId, r]));
  const now = Date.now();
  const shown: Record<string, AgentRequest[]> = {};
  for (const link of links.rows) {
    for (const draftId of link.draft_ids) {
      const review = byId.get(draftId);
      if (!review) continue;
      const created = links.created.get(draftId);
      const expiresAt =
        link.from_routine && created
          ? new Date(new Date(created).getTime() + REQUEST_EXPIRES_MS).toISOString()
          : null;
      (shown[link.answer_message_id] ??= []).push({
        draftId,
        capability: review.capability,
        description: review.description,
        recordType: review.recordType,
        status: review.status as AgentRequest['status'],
        values: review.values as Record<string, unknown>,
        display: review.display,
        expiresAt,
        expired: expiresAt !== null && Date.parse(expiresAt) < now,
        always: !/sign|pay|purchase/i.test(review.capability),
      });
    }
  }
  return shown;
}

export class RequestError extends Error {
  constructor(
    readonly code: 'not_found' | 'expired' | 'not_allowed' | 'settled',
    message: string,
  ) {
    super(message);
  }
}

/** The request she answers, if it is hers: the task that asked it, its agent, its answer. */
async function requestOf(db: SqlExecutor, identity: Identity, draftId: string) {
  const { rows } = await db.query<{
    task_id: string;
    agent_id: string;
    given_by: string;
    from_routine: boolean;
    answer_message_id: string | null;
    thread_id: string;
    created_at: Date;
  }>(
    `select t.task_id, t.agent_id, t.given_by, t.from_routine, x.answer_message_id, x.thread_id,
            d.created_at
       from agent_tasks t join agent_task_threads x on x.task_id = t.task_id
       join kete_drafts d on d.draft_id = $1
      where $1 = any(t.draft_ids)`,
    [draftId],
  );
  const found = rows[0];
  if (!found || found.given_by !== identity.userId) {
    throw new RequestError('not_found', 'No such request for her.');
  }
  return found;
}

/**
 * Her answer to what an agent asks (FR-015): allowed once, refused — or « Toujours… », allowed
 * this time and proposed as her policy, simulated over thirty days. Asked by a routine and not
 * answered within ten minutes, it is refused and nothing leaves.
 */
export async function answerRequest(
  identity: Identity,
  draftId: string,
  how: 'once' | 'always' | 'refuse',
): Promise<{ status: string; proposalId?: string }> {
  const found = await transaction(identity.organizationId, (db) =>
    requestOf(db, identity, draftId),
  );
  const expired =
    found.from_routine && new Date(found.created_at).getTime() + REQUEST_EXPIRES_MS < Date.now();
  if (expired && how !== 'refuse') {
    await asPerson(identity, () =>
      decideDraft(identity, draftId, { action: 'refuse', reason: 'expired' }),
    ).catch(() => undefined);
    throw new RequestError('expired', 'Asked by its routine, it expired: nothing left.');
  }
  const decided = await asPerson(identity, () =>
    decideDraft(
      identity,
      draftId,
      how === 'refuse' ? { action: 'refuse', reason: 'refused' } : { action: 'validate' },
    ),
  );
  if (decided.status === 'not_possible') {
    throw new RequestError(
      decided.reason === 'not_allowed' ? 'not_allowed' : 'settled',
      'This request cannot be decided.',
    );
  }
  if (how !== 'always' || !found.answer_message_id) return { status: decided.status };
  const [review] = await asPerson(identity, () => reviewDrafts(identity, [draftId]));
  if (!review || /sign|pay|purchase/i.test(review.capability)) return { status: decided.status };
  const proposalId = await transaction(identity.organizationId, async (db) => {
    const agent = await findAgent(db, found.agent_id);
    if (!agent) return undefined;
    const key = review.capability.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const policy = {
      id: `agent.${agent.agentId}.${key}`,
      sentence: messageWords().alwaysSentence(agent.name, review.description || review.capability),
      rule: `permit (principal == Kete::Agent::"${agent.agentId}", action == Kete::Action::"capability.use", resource == Kete::Capability::"${review.capability}");`,
      set: 'authority' as const,
      owner: identity.userId,
      status: 'trial' as const,
    };
    const simulated = await simulatePolicy(db, {
      engine,
      policy,
      since: new Date(Date.now() - 30 * 86_400_000),
      entitiesOf: (gesture) => entitiesFor(db, gesture),
    });
    const id = newId('prp');
    await db.query(
      `insert into kete_proposals (organization_id, proposal_id, message_id, thread_id,
         proposed_for, kind, body)
       values ($1, $2, $3, $4, $5, 'policy', $6)`,
      [
        identity.organizationId,
        id,
        found.answer_message_id,
        found.thread_id,
        identity.userId,
        JSON.stringify({
          rule: policy.sentence,
          template: 'agent.alone',
          policy,
          simulation: {
            replayed: simulated.replayed,
            changed: simulated.changed.length,
            byAgents: simulated.changed.filter((c) => c.gesture.actor.kind === 'agent').length,
          },
        }),
      ],
    );
    return id;
  });
  return { status: decided.status, ...(proposalId ? { proposalId } : {}) };
}

// --- What it takes on -----------------------------------------------------------------------------

/**
 * A holding given to a person (FR-016): the agent that acts for her and whose job description
 * covers it — or, by its setting, any of hers — proposes to take it on, or takes it on alone. The
 * holding stays hers; the agent is its delegate.
 */
export async function offerHolding(
  db: SqlExecutor,
  organizationId: string,
  input: { holdingId: string; holder: string; what: string; threadId: string; messageId: string },
): Promise<void> {
  const { rows } = await db.query<{ agent_id: string }>(
    `select agent_id from agents
      where status = 'active' and kind = 'personal' and responsible_user_id = $1
      order by created_at`,
    [input.holder],
  );
  const what = input.what.toLowerCase();
  for (const { agent_id } of rows) {
    const agent = await findAgent(db, agent_id);
    if (!agent) continue;
    const covered = agent.covers.some((word) => what.includes(word));
    const level = covered ? agent.takeOn.described : agent.takeOn.other;
    if (level === 'never') continue;
    if (level === 'alone') {
      await takeOn(db, organizationId, agent, input);
    } else {
      await db.query(
        `insert into kete_proposals (organization_id, proposal_id, message_id, thread_id,
           proposed_for, kind, body)
         values ($1, $2, $3, $4, $5, 'takeon', $6)`,
        [
          organizationId,
          newId('prp'),
          input.messageId,
          input.threadId,
          input.holder,
          JSON.stringify({
            agentId: agent.agentId,
            agentName: agent.name,
            holdingId: input.holdingId,
            what: input.what,
          }),
        ],
      );
    }
    return;
  }
}

async function takeOn(
  db: SqlExecutor,
  organizationId: string,
  agent: Agent,
  input: { holdingId: string; holder: string; what: string; threadId: string },
) {
  await delegateHolding(db, organizationId, {
    holdingId: input.holdingId,
    agent: agent.agentId,
    by: { kind: 'person', id: input.holder },
  });
  await giveToAgent(db, organizationId, {
    agent,
    givenBy: input.holder,
    instruction: input.what,
    threadId: input.threadId,
    holdingId: input.holdingId,
  });
  await joinThread(db, organizationId, input.threadId, { kind: 'agent', id: agent.agentId });
  await postMessage(db, organizationId, {
    thread: input.threadId,
    author: { kind: 'agent', id: agent.agentId },
    text: messageWords().takesOn(agent.name),
    for: 'information',
    via: 'kete',
  });
}

/** « Confier à l’agent »: the holder hands the holding to the agent that proposed it. */
export async function acceptTakeOn(db: SqlExecutor, identity: Identity, proposalId: string) {
  const { rows } = await db.query<{
    thread_id: string;
    body: { agentId: string; holdingId: string; what: string };
  }>(
    `select thread_id, body from kete_proposals
      where proposal_id = $1 and proposed_for = $2 and kind = 'takeon' and state = 'proposed'
      for update`,
    [proposalId, identity.userId],
  );
  const found = rows[0];
  if (!found) throw new RequestError('not_found', 'No such open proposal for her.');
  const agent = await findAgent(db, found.body.agentId);
  if (!agent || agent.status !== 'active') {
    throw new RequestError('not_allowed', 'This agent is not at work.');
  }
  await takeOn(db, identity.organizationId, agent, {
    holdingId: found.body.holdingId,
    holder: identity.userId,
    what: found.body.what,
    threadId: found.thread_id,
  });
  await db.query(
    `update kete_proposals set state = 'confirmed', decided_at = now() where proposal_id = $1`,
    [proposalId],
  );
}

/** « On le mentionne dans un fil » (FR-016): unless it never does, it sets to work there. */
export async function mentionedAgents(
  db: SqlExecutor,
  identity: Identity,
  input: { threadId: string; text: string; agents: string[] },
): Promise<string[]> {
  if (input.agents.length === 0) return [];
  const hers = await agentsOfHers(db, identity);
  const given: string[] = [];
  for (const agent of hers) {
    if (!input.agents.includes(agent.agentId) || agent.takeOn.mention === 'never') continue;
    const { task } = await giveToAgent(db, identity.organizationId, {
      agent,
      givenBy: identity.userId,
      instruction: input.text,
      threadId: input.threadId,
    });
    given.push(task.taskId);
  }
  return given;
}

// --- Its routine ----------------------------------------------------------------------------------

/** Its routine sets it to work: a task, as its person would have given it (FR-015). */
export async function runRoutine(db: SqlExecutor, organizationId: string, agent: Agent) {
  if (!agent.routine) return null;
  const owner = await personOfAgent(db, agent);
  if (!owner) return null;
  const { task } = await giveToAgent(db, organizationId, {
    agent,
    givenBy: owner,
    instruction: agent.routine.instruction,
    fromRoutine: true,
  });
  return task;
}

/** The routines due, across organizations: each sets its agent to work, then waits its next time. */
export async function runDueRoutines(now = new Date()): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string; agent_id: string }>(
    `select organization_id, agent_id from agent_routines_due()`,
  );
  for (const row of rows) {
    await transaction(row.organization_id, async (db) => {
      const agent = await findAgent(db, row.agent_id);
      if (!agent?.routine) return;
      const { rows: due } = await db.query<{ next_routine_at: Date | null }>(
        `select next_routine_at from agents where agent_id = $1`,
        [agent.agentId],
      );
      // The first time, it only learns when it is due next.
      if (due[0]?.next_routine_at) await runRoutine(db, row.organization_id, agent);
      await db.query(`update agents set next_routine_at = $2 where agent_id = $1`, [
        agent.agentId,
        nextRun(
          {
            cadence: agent.routine.cadence,
            weekday: null,
            time: agent.routine.time,
            timeZone: 'Africa/Lome',
          },
          now,
        ),
      ]);
    });
  }
  return rows.length;
}

// --- Her agents, as colleagues --------------------------------------------------------------------

export type AgentWorkState = 'needs' | 'working' | 'finished' | 'idle';

/**
 * Her agents by state (FR-013): needs her (a request waits, it is blocked or paused), works,
 * finished (an answer she has not read), idle — each with its thread; and how many work and wait.
 */
export async function agentsScreen(db: SqlExecutor, identity: Identity) {
  const on = (await readModules(db)).agents;
  const agents: {
    agentId: string;
    name: string;
    threadId: string;
    state: AgentWorkState;
    asks: number;
    unread: number;
    line: string;
    mine: boolean;
  }[] = [];
  for (const agent of await agentsOfHers(db, identity)) {
    const owner = await personOfAgent(db, agent);
    const threadId = await agentThreadOf(db, identity.organizationId, agent, identity.userId);
    const state = await stateOfAgent(db, agent, on);
    const { rows: unread } = await db.query<{ n: string; last: string | null }>(
      `select count(*) as n, max(m.text) filter (where m.at = (select max(at) from kete_messages
               where thread_id = $1 and author_kind = 'agent')) as last
         from kete_messages m
        where m.thread_id = $1 and m.author_kind = 'agent' and m.edited_from is null
          and not exists (select 1 from kete_message_reads r where r.message_id = m.message_id
                           and r.reader_kind = 'person' and r.reader_id = $2)`,
      [threadId, identity.userId],
    );
    const { rows: waiting } = await db.query<{ n: string }>(
      `select count(*) as n from kete_drafts where prepared_by_id = $1 and status = 'prepared'
          and on_behalf_of_id = $2`,
      [agent.agentId, identity.userId],
    );
    const asks = Number(waiting[0]?.n ?? 0);
    const unseen = Number(unread[0]?.n ?? 0);
    const kind: AgentWorkState =
      asks > 0 || state.kind === 'blocked' || state.kind === 'paused'
        ? 'needs'
        : state.kind === 'working'
          ? 'working'
          : unseen > 0
            ? 'finished'
            : 'idle';
    agents.push({
      agentId: agent.agentId,
      name: agent.name,
      threadId,
      state: kind,
      asks,
      unread: unseen,
      line:
        kind === 'needs'
          ? asks > 0
            ? messageWords().asks(asks)
            : (state.reason ?? '')
          : kind === 'working'
            ? `${state.instruction ?? ''}`.slice(0, 120)
            : kind === 'finished'
              ? (unread[0]?.last ?? '').slice(0, 120)
              : agent.routine
                ? messageWords().routineAt(agent.routine.time)
                : agent.mission.slice(0, 120),
      mine: owner === identity.userId,
    });
  }
  // The threads where her agents are members with her.
  const { rows: together } = await db.query<{ thread_id: string; title: string; agents: string[] }>(
    `select t.thread_id, t.title, array_agg(distinct a.agent_id) as agents
       from kete_thread_members ma
       join kete_threads t on t.thread_id = ma.thread_id and t.kind <> 'direct'
       join agents a on a.agent_id = ma.member_id
       join kete_thread_members me on me.thread_id = t.thread_id and me.member_kind = 'person'
            and me.member_id = $1 and me.until is null
      where ma.member_kind = 'agent' and ma.until is null and a.agent_id = any($2)
      group by t.thread_id, t.title order by t.title limit 10`,
    [identity.userId, agents.map((a) => a.agentId)],
  );
  return {
    agents,
    together: together.map((t) => ({
      threadId: t.thread_id,
      title: t.title,
      agents: t.agents
        .map((id) => agents.find((a) => a.agentId === id)?.name ?? '')
        .filter(Boolean),
    })),
    working: agents.filter((a) => a.state === 'working').length,
    needs: agents.filter((a) => a.state === 'needs').length,
  };
}

/** Beside its thread: its job description at work, its state, its month (FR-016). */
export async function agentSide(db: SqlExecutor, identity: Identity, thread: Thread) {
  const owner = await agentOfThread(db, thread.id);
  if (!owner) return null;
  const agent = await findAgent(db, owner.agentId);
  if (!agent) return null;
  const person = await personOfAgent(db, agent);
  const names = await namesOf(db, person ? [person] : [], identity, messageWords().outsider);
  const { rows: month } = await db.query<{ done: string; asked: string; refused: string }>(
    `select count(*) filter (where status = 'done') as done,
            coalesce(sum(cardinality(draft_ids)), 0) as asked,
            count(*) filter (where status in ('failed', 'stopped')) as refused
       from agent_tasks where agent_id = $1 and created_at >= date_trunc('month', now())`,
    [agent.agentId],
  );
  const { rows: used } = await db.query<{ minutes: string | null }>(
    `select sum(extract(epoch from (coalesce(finished_at, now()) - started_at)) / 60) as minutes
       from agent_tasks where agent_id = $1 and started_at >= date_trunc('month', now())
        and steps @> '[{"tool": "computer"}]'`,
    [agent.agentId],
  );
  const { rows: next } = await db.query<{ next_routine_at: Date | null }>(
    `select next_routine_at from agents where agent_id = $1`,
    [agent.agentId],
  );
  const on = (await readModules(db)).agents;
  return {
    agentId: agent.agentId,
    name: agent.name,
    mission: agent.mission,
    status: agent.status,
    person: person ? { id: person, name: names[person] ?? '' } : null,
    mine: person === identity.userId,
    state: await stateOfAgent(db, agent, on),
    month: {
      done: Number(month[0]?.done ?? 0),
      asked: Number(month[0]?.asked ?? 0),
      failed: Number(month[0]?.refused ?? 0),
    },
    permissions: agent.permissions.map((permission) => ({
      permission,
      level: agent.autonomyByPermission[permission] ?? agent.autonomyMax,
    })),
    autonomyMax: agent.autonomyMax,
    takeOn: agent.takeOn,
    covers: agent.covers,
    computerMinutes: agent.computerMinutes,
    computerUsed: Math.round(Number(used[0]?.minutes ?? 0)),
    returnTo: agent.returnTo,
    trialUntil: agent.trialUntil,
    routine: agent.routine,
    nextRoutineAt: next[0]?.next_routine_at
      ? new Date(next[0].next_routine_at).toISOString()
      : null,
    wakeEveryMinutes: agent.wakeEveryMinutes,
    watches: agent.watches,
    draftBudget: agent.draftBudget,
  };
}
