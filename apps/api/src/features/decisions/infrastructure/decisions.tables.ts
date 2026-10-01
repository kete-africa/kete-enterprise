import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type {
  ApproverRule,
  Circuit,
  CircuitStep,
  DecisionRequest,
  DecisionStep,
  RequestStatus,
  StepInput,
  StepStatus,
} from '../decisions.record.js';

/** Circuits, requests and their steps, with row-level security in the same migration. */
export function decisionsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  const rule = `rule text not null check (rule in ('manager', 'role', 'position', 'person')),
  role_id text,
  position_id text,
  person_id text,
  min_measure numeric check (min_measure >= 0),
  check ((rule = 'role') = (role_id is not null)),
  check ((rule = 'position') = (position_id is not null)),
  check ((rule = 'person') = (person_id is not null))`;
  return `
create table ${s}.circuits (
  circuit_id text primary key,
  organization_id text not null,
  subject text not null check (subject ~ '^[a-z]+\\.[a-z_]+$'),
  name text not null check (length(name) between 1 and 120),
  remind_after_hours integer not null default 48 check (remind_after_hours > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, circuit_id)
);
-- One active circuit per subject: a new version replaces it.
create unique index circuits_active on ${s}.circuits (organization_id, subject) where active;
${policy('circuits')}

create table ${s}.circuit_steps (
  organization_id text not null,
  circuit_id text not null,
  position integer not null check (position >= 1),
  ${rule},
  primary key (circuit_id, position),
  foreign key (organization_id, circuit_id) references ${s}.circuits (organization_id, circuit_id),
  foreign key (organization_id, role_id) references ${s}.roles (organization_id, role_id),
  foreign key (organization_id, position_id) references ${s}.positions (organization_id, position_id),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id)
);
${policy('circuit_steps')}

create table ${s}.decision_requests (
  request_id text primary key,
  organization_id text not null,
  circuit_id text not null,
  subject text not null,
  reference text not null,
  title text not null,
  requester_user_id text not null,
  unit_id text,
  measure numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (organization_id, request_id),
  unique (organization_id, subject, reference),
  foreign key (organization_id, circuit_id) references ${s}.circuits (organization_id, circuit_id),
  foreign key (organization_id, unit_id) references ${s}.units (organization_id, unit_id)
);
create index decision_requests_pending on ${s}.decision_requests (organization_id, status);
${policy('decision_requests')}

create table ${s}.decision_steps (
  organization_id text not null,
  request_id text not null,
  position integer not null,
  ${rule},
  status text not null check (status in ('pending', 'approved', 'refused', 'skipped')),
  decided_by text,
  decided_at timestamptz,
  reason text,
  entered_at timestamptz,
  primary key (request_id, position),
  foreign key (organization_id, request_id)
    references ${s}.decision_requests (organization_id, request_id)
);
${policy('decision_steps')}

grant select, insert, update on ${s}.circuits, ${s}.circuit_steps, ${s}.decision_requests,
  ${s}.decision_steps to ${options.appRole};
`;
}

type RuleColumns = {
  rule: ApproverRule['rule'];
  role_id: string | null;
  position_id: string | null;
  person_id: string | null;
  min_measure: string | null;
};

function ruleOf(row: RuleColumns): ApproverRule {
  switch (row.rule) {
    case 'role':
      return { rule: 'role', roleId: row.role_id ?? '' };
    case 'position':
      return { rule: 'position', positionId: row.position_id ?? '' };
    case 'person':
      return { rule: 'person', personId: row.person_id ?? '' };
    default:
      return { rule: 'manager' };
  }
}

const ruleValues = (step: StepInput) => [
  step.rule,
  step.rule === 'role' ? step.roleId : null,
  step.rule === 'position' ? step.positionId : null,
  step.rule === 'person' ? step.personId : null,
  step.minMeasure ?? null,
];

/** Defines a circuit; the one active for the subject, if any, stops applying to new requests. */
export async function insertCircuit(
  db: SqlExecutor,
  organizationId: string,
  input: { subject: string; name: string; remindAfterHours: number; steps: StepInput[] },
): Promise<Circuit> {
  await db.query(`update circuits set active = false where subject = $1 and active`, [
    input.subject,
  ]);
  const circuitId = newId('cir');
  await db.query(
    `insert into circuits (circuit_id, organization_id, subject, name, remind_after_hours)
     values ($1, $2, $3, $4, $5)`,
    [circuitId, organizationId, input.subject, input.name, input.remindAfterHours],
  );
  for (const [index, step] of input.steps.entries()) {
    await db.query(
      `insert into circuit_steps (organization_id, circuit_id, position, rule, role_id,
         position_id, person_id, min_measure)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [organizationId, circuitId, index + 1, ...ruleValues(step)],
    );
  }
  return (await findCircuit(db, circuitId)) as Circuit;
}

type CircuitRow = {
  circuit_id: string;
  subject: string;
  name: string;
  remind_after_hours: number;
};

async function stepsOfCircuit(db: SqlExecutor, circuitId: string): Promise<CircuitStep[]> {
  const { rows } = await db.query<RuleColumns & { position: number }>(
    `select position, rule, role_id, position_id, person_id, min_measure
       from circuit_steps where circuit_id = $1 order by position`,
    [circuitId],
  );
  return rows.map((row) => ({
    position: row.position,
    rule: ruleOf(row),
    minMeasure: row.min_measure === null ? null : Number(row.min_measure),
  }));
}

export async function findCircuit(db: SqlExecutor, circuitId: string): Promise<Circuit | null> {
  const { rows } = await db.query<CircuitRow>(
    `select circuit_id, subject, name, remind_after_hours from circuits where circuit_id = $1`,
    [circuitId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    circuitId: row.circuit_id,
    subject: row.subject,
    name: row.name,
    remindAfterHours: row.remind_after_hours,
    steps: await stepsOfCircuit(db, row.circuit_id),
  };
}

export async function activeCircuit(db: SqlExecutor, subject: string): Promise<Circuit | null> {
  const { rows } = await db.query<{ circuit_id: string }>(
    `select circuit_id from circuits where subject = $1 and active`,
    [subject],
  );
  return rows[0] ? findCircuit(db, rows[0].circuit_id) : null;
}

export async function listActiveCircuits(db: SqlExecutor): Promise<Circuit[]> {
  const { rows } = await db.query<{ circuit_id: string }>(
    `select circuit_id from circuits where active order by subject`,
  );
  return Promise.all(rows.map(async (row) => (await findCircuit(db, row.circuit_id)) as Circuit));
}

export async function insertRequest(
  db: SqlExecutor,
  organizationId: string,
  input: {
    circuit: Circuit;
    reference: string;
    title: string;
    requesterUserId: string;
    unitId: string | null;
    measure: number | null;
  },
): Promise<string> {
  const requestId = newId('drq');
  await db.query(
    `insert into decision_requests (request_id, organization_id, circuit_id, subject, reference,
       title, requester_user_id, unit_id, measure)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      requestId,
      organizationId,
      input.circuit.circuitId,
      input.circuit.subject,
      input.reference,
      input.title,
      input.requesterUserId,
      input.unitId,
      input.measure,
    ],
  );
  let first = true;
  for (const step of input.circuit.steps) {
    // Under its threshold, a step does not apply to this request.
    const applies =
      step.minMeasure === null || (input.measure !== null && input.measure >= step.minMeasure);
    const status: StepStatus = applies ? 'pending' : 'skipped';
    await db.query(
      `insert into decision_steps (organization_id, request_id, position, rule, role_id,
         position_id, person_id, min_measure, status, entered_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        organizationId,
        requestId,
        step.position,
        ...ruleValues({
          ...step.rule,
          ...(step.minMeasure === null ? {} : { minMeasure: step.minMeasure }),
        }),
        status,
        applies && first ? new Date() : null,
      ],
    );
    if (applies) first = false;
  }
  return requestId;
}

type RequestRow = {
  request_id: string;
  circuit_id: string;
  subject: string;
  reference: string;
  title: string;
  requester_user_id: string;
  unit_id: string | null;
  measure: string | null;
  status: RequestStatus;
  created_at: Date;
};

export async function findRequest(
  db: SqlExecutor,
  requestId: string,
  options: { lock?: boolean } = {},
): Promise<DecisionRequest | null> {
  const { rows } = await db.query<RequestRow>(
    `select request_id, circuit_id, subject, reference, title, requester_user_id, unit_id, measure,
            status, created_at
       from decision_requests where request_id = $1 ${options.lock ? 'for update' : ''}`,
    [requestId],
  );
  const row = rows[0];
  if (!row) return null;
  const steps = await db.query<
    RuleColumns & {
      position: number;
      status: StepStatus;
      decided_by: string | null;
      decided_at: Date | null;
      reason: string | null;
      entered_at: Date | null;
    }
  >(
    `select position, rule, role_id, position_id, person_id, min_measure, status, decided_by,
            decided_at, reason, entered_at
       from decision_steps where request_id = $1 order by position`,
    [requestId],
  );
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    requestId: row.request_id,
    circuitId: row.circuit_id,
    subject: row.subject,
    reference: row.reference,
    title: row.title,
    requesterUserId: row.requester_user_id,
    unitId: row.unit_id,
    measure: row.measure === null ? null : Number(row.measure),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    steps: steps.rows.map((s): DecisionStep => ({
      position: s.position,
      rule: ruleOf(s),
      minMeasure: s.min_measure === null ? null : Number(s.min_measure),
      status: s.status,
      decidedBy: s.decided_by,
      decidedAt: iso(s.decided_at),
      reason: s.reason,
      enteredAt: iso(s.entered_at),
    })),
  };
}

export async function pendingRequestIds(db: SqlExecutor): Promise<string[]> {
  const { rows } = await db.query<{ request_id: string }>(
    `select request_id from decision_requests where status = 'pending' order by created_at`,
  );
  return rows.map((row) => row.request_id);
}

export async function requestIdsOf(db: SqlExecutor, requesterUserId: string): Promise<string[]> {
  const { rows } = await db.query<{ request_id: string }>(
    `select request_id from decision_requests where requester_user_id = $1
      order by created_at desc limit 50`,
    [requesterUserId],
  );
  return rows.map((row) => row.request_id);
}

export async function decideStep(
  db: SqlExecutor,
  requestId: string,
  position: number,
  status: 'approved' | 'refused',
  decidedBy: string,
  reason: string | null,
): Promise<void> {
  await db.query(
    `update decision_steps set status = $3, decided_by = $4, decided_at = now(), reason = $5
      where request_id = $1 and position = $2`,
    [requestId, position, status, decidedBy, reason],
  );
}

export async function enterStep(db: SqlExecutor, requestId: string, position: number) {
  await db.query(
    `update decision_steps set entered_at = now() where request_id = $1 and position = $2`,
    [requestId, position],
  );
}

export async function closeRequest(db: SqlExecutor, requestId: string, status: RequestStatus) {
  await db.query(
    `update decision_requests set status = $2, decided_at = now() where request_id = $1`,
    [requestId, status],
  );
}

/**
 * The people (by their Compte Kete account) who approve a step today: found from the structure and
 * the rights at the time they look, so an interim or a delegation holding the position approves.
 */
export async function approversOf(
  db: SqlExecutor,
  request: Pick<DecisionRequest, 'requesterUserId' | 'unitId'>,
  rule: ApproverRule,
): Promise<Set<string>> {
  const active = (alias: string) =>
    `${alias}.starts_on <= current_date and (${alias}.ends_on is null or ${alias}.ends_on >= current_date)`;
  const holders = (positions: string) => `
    select pe.account_user_id from assignments a join people pe on pe.person_id = a.person_id
     where a.position_id in (${positions}) and ${active('a')}
       and pe.account_user_id is not null`;
  let text: string;
  let values: unknown[];
  switch (rule.rule) {
    case 'manager':
      text = holders(`
        select p.reports_to from assignments a
          join people pe on pe.person_id = a.person_id
          join positions p on p.position_id = a.position_id
         where pe.account_user_id = $1 and a.kind = 'primary' and ${active('a')}
           and p.reports_to is not null`);
      values = [request.requesterUserId];
      break;
    case 'position':
      text = holders('$1');
      values = [rule.positionId];
      break;
    case 'person':
      text = `select account_user_id from people where person_id = $1 and account_user_id is not null`;
      values = [rule.personId];
      break;
    case 'role':
      // The role's grants that cover the request's unit: everywhere, one of its units or above, or
      // its country (or a country above it).
      text = `
        with recursive up as (
          select unit_id, parent_id, country from units where unit_id = $2
          union
          select u.unit_id, u.parent_id, u.country from units u join up on u.unit_id = up.parent_id
        ),
        grants as (
          select g.position_id, g.person_id from role_grants g
           where g.role_id = $1 and ${active('g')}
             and ((g.scope_unit_id is null and g.scope_country is null)
                  or g.scope_unit_id in (select unit_id from up)
                  or g.scope_country in (select country from up where country is not null))
        )
        select pe.account_user_id from people pe
         where pe.person_id in (select person_id from grants where person_id is not null)
           and pe.account_user_id is not null
        union
        ${holders('select position_id from grants where position_id is not null')}`;
      values = [rule.roleId, request.unitId];
      break;
  }
  const { rows } = await db.query<{ account_user_id: string }>(text, values);
  return new Set(rows.map((row) => row.account_user_id));
}
