import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { Agent, AgentKind, Finding, Signal } from '../agents.record.js';

/**
 * Agents and their signals, with row-level security in the same migration. The worker wakes the
 * agents of every organization: a definer function gives it their identifiers, and nothing else;
 * each agent then runs in its own organization's transaction.
 */
export function agentsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.agents (
  agent_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('personal', 'position', 'system')),
  mission text not null,
  responsible_user_id text,
  position_id text,
  scope_unit_id text,
  permissions text[] not null default '{}',
  autonomy_max integer not null default 1 check (autonomy_max between 1 and 4),
  draft_budget integer not null default 5 check (draft_budget >= 0),
  wake_every_minutes integer not null default 60 check (wake_every_minutes >= 5),
  watches text[] not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  next_wake_at timestamptz not null default now(),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'position') = (position_id is not null)),
  check (kind = 'position' or responsible_user_id is not null),
  unique (organization_id, agent_id),
  foreign key (organization_id, position_id) references ${s}.positions (organization_id, position_id),
  foreign key (organization_id, scope_unit_id) references ${s}.units (organization_id, unit_id)
);
${policy('agents')}

create table ${s}.agent_signals (
  signal_id text primary key,
  organization_id text not null,
  agent_id text not null,
  watch text not null,
  key text not null,
  kind text not null,
  subject text not null,
  unit_id text,
  details jsonb not null default '{}',
  raised_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_reason text check (closed_reason in ('solved', 'resolved')),
  closed_by text,
  foreign key (organization_id, agent_id) references ${s}.agents (organization_id, agent_id)
);
-- One open signal per problem and agent.
create unique index agent_signals_open on ${s}.agent_signals (agent_id, key) where closed_at is null;
${policy('agent_signals')}

grant select, insert, update on ${s}.agents, ${s}.agent_signals to ${options.appRole};

create function ${s}.agents_due() returns table (organization_id text, agent_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, agent_id from agents where status = 'active' and next_wake_at <= now() $$;
revoke all on function ${s}.agents_due() from public;
grant execute on function ${s}.agents_due() to ${options.appRole};
`;
}

type AgentRow = {
  agent_id: string;
  name: string;
  kind: AgentKind;
  mission: string;
  responsible_user_id: string | null;
  position_id: string | null;
  scope_unit_id: string | null;
  permissions: string[];
  autonomy_max: number;
  draft_budget: number;
  wake_every_minutes: number;
  watches: string[];
  status: 'active' | 'paused';
  next_wake_at: Date;
  last_run_at: Date | null;
};

const toAgent = (r: AgentRow): Agent => ({
  agentId: r.agent_id,
  name: r.name,
  kind: r.kind,
  mission: r.mission,
  responsibleUserId: r.responsible_user_id,
  positionId: r.position_id,
  scopeUnitId: r.scope_unit_id,
  permissions: r.permissions,
  autonomyMax: r.autonomy_max,
  draftBudget: r.draft_budget,
  wakeEveryMinutes: r.wake_every_minutes,
  watches: r.watches,
  status: r.status,
  nextWakeAt: new Date(r.next_wake_at).toISOString(),
  lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
});

const agentColumns = `agent_id, name, kind, mission, responsible_user_id, position_id, scope_unit_id,
  permissions, autonomy_max, draft_budget, wake_every_minutes, watches, status, next_wake_at,
  last_run_at`;

export async function insertAgent(
  db: SqlExecutor,
  organizationId: string,
  input: {
    name: string;
    kind: AgentKind;
    mission: string;
    responsibleUserId: string | null;
    positionId: string | null;
    scopeUnitId: string | null;
    permissions: string[];
    autonomyMax: number;
    draftBudget: number;
    wakeEveryMinutes: number;
    watches: string[];
  },
): Promise<Agent> {
  const { rows } = await db.query<AgentRow>(
    `insert into agents (agent_id, organization_id, name, kind, mission, responsible_user_id,
       position_id, scope_unit_id, permissions, autonomy_max, draft_budget, wake_every_minutes,
       watches)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning ${agentColumns}`,
    [
      newId('agt'),
      organizationId,
      input.name,
      input.kind,
      input.mission,
      input.responsibleUserId,
      input.positionId,
      input.scopeUnitId,
      [...new Set(input.permissions)].sort(),
      input.autonomyMax,
      input.draftBudget,
      input.wakeEveryMinutes,
      [...new Set(input.watches)].sort(),
    ],
  );
  return toAgent(rows[0] as AgentRow);
}

export async function findAgent(db: SqlExecutor, agentId: string): Promise<Agent | null> {
  const { rows } = await db.query<AgentRow>(
    `select ${agentColumns} from agents where agent_id = $1`,
    [agentId],
  );
  return rows[0] ? toAgent(rows[0]) : null;
}

export async function listAgents(db: SqlExecutor): Promise<Agent[]> {
  const { rows } = await db.query<AgentRow>(`select ${agentColumns} from agents order by name`);
  return rows.map(toAgent);
}

export async function setStatus(db: SqlExecutor, agentId: string, status: Agent['status']) {
  await db.query(`update agents set status = $2 where agent_id = $1`, [agentId, status]);
}

export async function markRun(db: SqlExecutor, agentId: string): Promise<void> {
  await db.query(
    `update agents set last_run_at = now(),
       next_wake_at = now() + make_interval(mins => wake_every_minutes)
      where agent_id = $1`,
    [agentId],
  );
}

/** The agents due, across organizations: their identifiers only (the definer function). */
export async function dueAgents(
  db: SqlExecutor,
): Promise<{ organizationId: string; agentId: string }[]> {
  const { rows } = await db.query<{ organization_id: string; agent_id: string }>(
    `select organization_id, agent_id from agents_due()`,
  );
  return rows.map((row) => ({ organizationId: row.organization_id, agentId: row.agent_id }));
}

/**
 * Whom the agent acts for today: its responsible person, or — for a position's agent — whoever
 * holds the position (a primary holder first, then an interim or a delegation).
 */
export async function personOfAgent(db: SqlExecutor, agent: Agent): Promise<string | null> {
  if (agent.kind !== 'position') return agent.responsibleUserId;
  const { rows } = await db.query<{ account_user_id: string }>(
    `select pe.account_user_id from assignments a join people pe on pe.person_id = a.person_id
      where a.position_id = $1 and pe.account_user_id is not null
        and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
      order by case a.kind when 'primary' then 0 when 'interim' then 1 else 2 end, a.starts_on
      limit 1`,
    [agent.positionId],
  );
  return rows[0]?.account_user_id ?? null;
}

/** A unit and everything under it. */
export async function subtreeOf(db: SqlExecutor, unitId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ unit_id: string }>(
    `with recursive down as (
       select unit_id from units where unit_id = $1
       union
       select u.unit_id from units u join down on u.parent_id = down.unit_id
     ) select unit_id from down`,
    [unitId],
  );
  return new Set(rows.map((row) => row.unit_id));
}

type SignalRow = {
  signal_id: string;
  agent_id: string;
  watch: string;
  key: string;
  kind: string;
  subject: string;
  unit_id: string | null;
  details: Record<string, unknown>;
  raised_at: Date;
  closed_at: Date | null;
  closed_reason: Signal['closedReason'];
};
const toSignal = (r: SignalRow): Signal => ({
  signalId: r.signal_id,
  agentId: r.agent_id,
  watch: r.watch,
  key: r.key,
  kind: r.kind,
  subject: r.subject,
  unitId: r.unit_id,
  details: r.details,
  raisedAt: new Date(r.raised_at).toISOString(),
  closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  closedReason: r.closed_reason,
});
const signalColumns = `signal_id, agent_id, watch, key, kind, subject, unit_id, details, raised_at,
  closed_at, closed_reason`;

export async function insertSignal(
  db: SqlExecutor,
  organizationId: string,
  input: Finding & { agentId: string; watch: string },
): Promise<Signal> {
  const { rows } = await db.query<SignalRow>(
    `insert into agent_signals (signal_id, organization_id, agent_id, watch, key, kind, subject,
       unit_id, details)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${signalColumns}`,
    [
      newId('sig'),
      organizationId,
      input.agentId,
      input.watch,
      input.key,
      input.kind,
      input.subject,
      input.unitId,
      JSON.stringify(input.details),
    ],
  );
  return toSignal(rows[0] as SignalRow);
}

export async function openSignals(db: SqlExecutor, agentId: string): Promise<Signal[]> {
  const { rows } = await db.query<SignalRow>(
    `select ${signalColumns} from agent_signals where agent_id = $1 and closed_at is null
      order by raised_at`,
    [agentId],
  );
  return rows.map(toSignal);
}

export async function findSignal(db: SqlExecutor, signalId: string): Promise<Signal | null> {
  const { rows } = await db.query<SignalRow>(
    `select ${signalColumns} from agent_signals where signal_id = $1`,
    [signalId],
  );
  return rows[0] ? toSignal(rows[0]) : null;
}

export async function closeSignal(
  db: SqlExecutor,
  signalId: string,
  reason: 'solved' | 'resolved',
  closedBy: string,
): Promise<void> {
  await db.query(
    `update agent_signals set closed_at = now(), closed_reason = $2, closed_by = $3
      where signal_id = $1 and closed_at is null`,
    [signalId, reason, closedBy],
  );
}
