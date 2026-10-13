import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { findAgent, personOfAgent } from '../agents/index.js';
import { readModules } from '../organization/index.js';

// « Mon accueil » (spec 067, doctrine D-044): for each person, what arrives at her and who takes
// care of it. It works without any setting — everything arrives at her. A rule of hers hands the
// requests that speak of something to one of her own agents, which prepares; she still reads and
// signs what goes back. While she is away, her requests go to the colleague she named.
//
// Its safeguards: a rule names only her own agent; the organization's kill switch comes before her
// rules; nothing a rule does returns to who asked without her signature; who asks sees a state,
// never her rules nor her private agents.

export function receptionMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.reception_rules (
  organization_id text not null,
  rule_id text not null,
  user_id text not null,
  -- The request speaks of one of these words: its title or its details.
  words text[] not null check (cardinality(words) between 1 and 10),
  agent_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, rule_id),
  foreign key (organization_id, agent_id)
    references ${s}.agents (organization_id, agent_id) on delete cascade
);
create index reception_rules_user on ${s}.reception_rules (organization_id, user_id, created_at);
${policy('reception_rules')}
grant select, insert, delete on ${s}.reception_rules to ${options.appRole};

create table ${s}.reception_absences (
  organization_id text not null,
  user_id text not null,
  starts_on date not null,
  ends_on date not null,
  delegate_user_id text not null,
  delegate_name text not null check (length(delegate_name) between 1 and 200),
  check (ends_on >= starts_on),
  check (delegate_user_id <> user_id),
  primary key (organization_id, user_id)
);
${policy('reception_absences')}
grant select, insert, update, delete on ${s}.reception_absences to ${options.appRole};
`;
}

export interface ReceptionRule {
  ruleId: string;
  words: string[];
  agent: { agentId: string; name: string };
  /** False when its agent is paused, no longer hers, or the organization's agents are off. */
  applies: boolean;
}

export interface Absence {
  startsOn: string;
  endsOn: string;
  delegate: { userId: string; name: string };
}

export interface Reception {
  rules: ReceptionRule[];
  absence: Absence | null;
}

/** Words as they are compared: lower case, without accents. */
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const day = (date: Date) => date.toISOString().slice(0, 10);

type RuleRow = { rule_id: string; words: string[]; agent_id: string };
type AbsenceRow = {
  starts_on: string;
  ends_on: string;
  delegate_user_id: string;
  delegate_name: string;
};

async function absenceRow(db: SqlExecutor, userId: string): Promise<AbsenceRow | null> {
  const { rows } = await db.query<AbsenceRow>(
    // Days as text: a date read as a moment shifts with the server's time zone.
    `select starts_on::text, ends_on::text, delegate_user_id, delegate_name
       from reception_absences where user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

const absenceOf = (row: AbsenceRow): Absence => ({
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  delegate: { userId: row.delegate_user_id, name: row.delegate_name },
});

/** Her rules in order, and her absence: hers alone to read. */
export async function receptionOf(db: SqlExecutor, userId: string): Promise<Reception> {
  const { rows } = await db.query<RuleRow>(
    `select rule_id, words, agent_id from reception_rules
      where user_id = $1 order by created_at, rule_id`,
    [userId],
  );
  const on = (await readModules(db)).agents;
  const rules: ReceptionRule[] = [];
  for (const row of rows) {
    const agent = await findAgent(db, row.agent_id);
    if (!agent) continue;
    rules.push({
      ruleId: row.rule_id,
      words: row.words,
      agent: { agentId: agent.agentId, name: agent.name },
      applies: on && agent.status === 'active' && (await personOfAgent(db, agent)) === userId,
    });
  }
  const away = await absenceRow(db, userId);
  return { rules, absence: away ? absenceOf(away) : null };
}

/** The first of her rules a request falls under — one that applies — or none: it is hers. */
export async function ruleFor(
  db: SqlExecutor,
  userId: string,
  text: string,
): Promise<(ReceptionRule & { word: string }) | null> {
  const said = plain(text);
  for (const rule of (await receptionOf(db, userId)).rules) {
    if (!rule.applies) continue;
    const word = rule.words.find((candidate) => said.includes(plain(candidate)));
    if (word) return { ...rule, word };
  }
  return null;
}

/** The colleague her requests go to today, when she is away; none otherwise. */
export async function awayTo(
  db: SqlExecutor,
  userId: string,
  today: string = day(new Date()),
): Promise<Absence | null> {
  const row = await absenceRow(db, userId);
  if (!row) return null;
  const absence = absenceOf(row);
  return absence.startsOn <= today && today <= absence.endsOn ? absence : null;
}

export class ReceptionRefusal extends Error {
  constructor(readonly reason: 'not_her_agent' | 'too_many' | 'not_found') {
    super(reason);
    this.name = 'ReceptionRefusal';
  }
}

/** A rule of hers: requests that speak of these words go to this agent of hers, which prepares. */
export async function addRule(
  db: SqlExecutor,
  who: { organizationId: string; userId: string },
  input: { words: string[]; agentId: string },
): Promise<void> {
  const agent = await findAgent(db, input.agentId);
  // Only her own agent: a rule never reaches a colleague's, shared or not.
  if (!agent || agent.status !== 'active' || (await personOfAgent(db, agent)) !== who.userId) {
    throw new ReceptionRefusal('not_her_agent');
  }
  const { rows } = await db.query<{ n: string }>(
    'select count(*) as n from reception_rules where user_id = $1',
    [who.userId],
  );
  if (Number(rows[0]?.n ?? 0) >= 20) throw new ReceptionRefusal('too_many');
  const words = [...new Set(input.words.map((word) => word.trim()).filter(Boolean))];
  await db.query(
    `insert into reception_rules (organization_id, rule_id, user_id, words, agent_id)
     values ($1, $2, $3, $4, $5)`,
    [who.organizationId, newId('rcp'), who.userId, words, agent.agentId],
  );
}

export async function removeRule(db: SqlExecutor, userId: string, ruleId: string): Promise<void> {
  const { rows } = await db.query(
    'delete from reception_rules where rule_id = $1 and user_id = $2 returning rule_id',
    [ruleId, userId],
  );
  if (rows.length === 0) throw new ReceptionRefusal('not_found');
}

/** She is away between two days: what is asked of her goes to this colleague. */
export async function setAbsence(
  db: SqlExecutor,
  who: { organizationId: string; userId: string },
  input: { startsOn: string; endsOn: string; delegate: { userId: string; name: string } },
): Promise<void> {
  await db.query(
    `insert into reception_absences
       (organization_id, user_id, starts_on, ends_on, delegate_user_id, delegate_name)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, user_id) do update
       set starts_on = excluded.starts_on, ends_on = excluded.ends_on,
           delegate_user_id = excluded.delegate_user_id, delegate_name = excluded.delegate_name`,
    [
      who.organizationId,
      who.userId,
      input.startsOn,
      input.endsOn,
      input.delegate.userId,
      input.delegate.name,
    ],
  );
}

export async function clearAbsence(db: SqlExecutor, userId: string): Promise<void> {
  await db.query('delete from reception_absences where user_id = $1', [userId]);
}

/** What would become of a request asked of her today: who takes care of it, what goes back. */
export interface ReceptionTrial {
  handledBy:
    | { kind: 'me' }
    | { kind: 'agent'; name: string; word: string }
    | { kind: 'away'; name: string; until: string };
  /** What goes back is always read and signed by a person. */
  returns: 'signed';
}

export async function tryReception(
  db: SqlExecutor,
  userId: string,
  text: string,
): Promise<ReceptionTrial> {
  const away = await awayTo(db, userId);
  if (away) {
    return {
      handledBy: { kind: 'away', name: away.delegate.name, until: away.endsOn },
      returns: 'signed',
    };
  }
  const rule = await ruleFor(db, userId, text);
  return {
    handledBy: rule ? { kind: 'agent', name: rule.agent.name, word: rule.word } : { kind: 'me' },
    returns: 'signed',
  };
}
