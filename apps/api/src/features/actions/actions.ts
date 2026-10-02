import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

/**
 * The register of actions (spec 013): what meetings decide, what indicators in orange or red call
 * for, and — read beside them — the audits' corrective actions (spec 008). One owner, one deadline.
 */
export function actionsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.actions (
  action_id text primary key,
  organization_id text not null,
  title text not null check (length(title) between 1 and 400),
  detail text,
  source text not null check (source in ('meeting', 'indicator', 'review', 'manual')),
  source_ref text,
  responsible_person_id text not null,
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  done_note text,
  done_by text,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, action_id),
  foreign key (organization_id, responsible_person_id)
    references ${s}.people (organization_id, person_id)
);
create index actions_open on ${s}.actions (organization_id, status, due_on);
create index actions_person on ${s}.actions (organization_id, responsible_person_id);
${organizationPolicySql({ schema: s, table: 'actions', appRole: options.appRole })}
grant select, insert, update on ${s}.actions to ${options.appRole};
`;
}

export interface Action {
  actionId: string;
  title: string;
  detail: string | null;
  source: 'meeting' | 'indicator' | 'review' | 'manual' | 'audit';
  sourceRef: string | null;
  responsiblePersonId: string | null;
  responsibleName: string | null;
  dueOn: string;
  status: 'open' | 'done' | 'cancelled' | 'verified';
  overdue: boolean;
  doneNote: string | null;
}

/** Opens an action in the caller's transaction: meetings and indicators call it. */
export async function openAction(
  db: SqlExecutor,
  organizationId: string,
  input: {
    title: string;
    detail?: string | null | undefined;
    source: 'meeting' | 'indicator' | 'review' | 'manual';
    sourceRef?: string | null | undefined;
    responsiblePersonId: string;
    dueOn: string;
  },
): Promise<string> {
  const actionId = newId('act');
  await db.query(
    `insert into actions (action_id, organization_id, title, detail, source, source_ref,
       responsible_person_id, due_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actionId,
      organizationId,
      input.title.slice(0, 400),
      input.detail ?? null,
      input.source,
      input.sourceRef ?? null,
      input.responsiblePersonId,
      input.dueOn,
    ],
  );
  return actionId;
}

/**
 * The register: the organization's actions and the audits' corrective actions, overdue first. With a
 * person, only hers.
 */
export async function readRegister(
  db: SqlExecutor,
  filter: { personId?: string; openOnly?: boolean } = {},
): Promise<Action[]> {
  const { rows } = await db.query<{
    action_id: string;
    title: string;
    detail: string | null;
    source: Action['source'];
    source_ref: string | null;
    person_id: string | null;
    name: string | null;
    due_on: string;
    status: Action['status'];
    done_note: string | null;
  }>(
    `select * from (
       select a.action_id, a.title, a.detail, a.source, a.source_ref,
              a.responsible_person_id as person_id, pe.name, to_char(a.due_on, 'YYYY-MM-DD') as due_on,
              a.status, a.done_note
         from actions a join people pe on pe.person_id = a.responsible_person_id
       union all
       select c.action_id, c.description, null, 'audit', c.finding_id, pe.person_id, pe.name,
              to_char(c.due_on, 'YYYY-MM-DD'), c.status, null
         from corrective_actions c left join people pe on pe.account_user_id = c.owner_user_id
     ) register
     where ($1::text is null or person_id = $1)
       and (not $2 or status = 'open')
     order by (status = 'open' and due_on::date < current_date) desc, due_on`,
    [filter.personId ?? null, filter.openOnly ?? false],
  );
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({
    actionId: r.action_id,
    title: r.title,
    detail: r.detail,
    source: r.source,
    sourceRef: r.source_ref,
    responsiblePersonId: r.person_id,
    responsibleName: r.name,
    dueOn: r.due_on,
    status: r.status,
    overdue: r.status === 'open' && r.due_on < today,
    doneNote: r.done_note,
  }));
}

export class ActionRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_yours' | 'closed',
    message: string,
  ) {
    super(message);
    this.name = 'ActionRuleError';
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const actionId = z.string().regex(/^act_[0-9a-f-]{8,64}$/);

export const createAction = defineCommand({
  name: 'create-action',
  input: z.object({
    title: z.string().trim().min(1).max(400),
    detail: z.string().trim().max(2000).optional(),
    responsiblePersonId: z.string().regex(/^prs_[0-9a-f-]{8,64}$/),
    dueOn: day,
  }),
  reversibility: { reversible: true, inverse: 'cancel-action' },
  async handler(input, { db, organizationId }) {
    const actionId = await openAction(db, organizationId, { ...input, source: 'manual' }).catch(
      (error: { code?: string }) => {
        if (error.code === '23503') throw new ActionRuleError('not_found', 'No such person.');
        throw error;
      },
    );
    return { actionId };
  },
  summarize: (input) => `Action « ${input.title} » opened`,
});

export const completeAction = defineCommand({
  name: 'complete-action',
  input: z.object({
    actionId,
    note: z.string().trim().min(1).max(2000),
    /** The person closing it, set by the API: its owner, or whoever runs the register. */
    actingPersonId: z
      .string()
      .regex(/^prs_[0-9a-f-]{8,64}$/)
      .nullable(),
    manages: z.boolean(),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const { rows } = await db.query<{ responsible_person_id: string; status: string }>(
      `select responsible_person_id, status from actions where action_id = $1 for update`,
      [input.actionId],
    );
    const action = rows[0];
    if (!action) throw new ActionRuleError('not_found', 'No such action.');
    if (action.status !== 'open') throw new ActionRuleError('closed', 'It is already closed.');
    if (action.responsible_person_id !== input.actingPersonId && !input.manages) {
      throw new ActionRuleError('not_yours', 'Only its owner closes it.');
    }
    await db.query(
      `update actions set status = 'done', done_note = $2, done_by = $3, done_at = now()
        where action_id = $1`,
      [input.actionId, input.note, actor.id],
    );
    return { actionId: input.actionId };
  },
  summarize: (input) => `Action ${input.actionId} done`,
});

export const cancelAction = defineCommand({
  name: 'cancel-action',
  input: z.object({ actionId }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const { rows } = await db.query(
      `update actions set status = 'cancelled' where action_id = $1 and status = 'open'
       returning action_id`,
      [input.actionId],
    );
    if (rows.length === 0) throw new ActionRuleError('not_found', 'No open action of that id.');
    return input;
  },
  summarize: (input) => `Action ${input.actionId} cancelled`,
});
