import { MAX_ROWS, type DatasetRow } from '@kete/metrics';
import type { Dataset } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { kindsOf, sightOf, sightSql } from '../objects/index.js';
import { reach } from '../rights/index.js';
import type { IdentityVariables } from '../../platform/identity.js';

// The center's own sources (spec 102; ADR 0015): what Kete Enterprise itself can measure, declared
// as an app declares its data sets (dataset.v1, with the four axes) and summed up by the same engine.
// A row is hers to count when its object is hers to see (R4): the same sight as everywhere.

type Identity = IdentityVariables['identity'];

const field = (type: 'string' | 'number') => ({ type: [type, 'null'] });
const row = (fields: Record<string, 'string' | 'number'>) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(fields).map(([k, t]) => [k, field(t)])),
});
const AXES = { project: 'project_id', party: 'party_id', unit: 'unit_id', person: 'person_id' };

export const CENTER = 'center';

/** What is in progress, and who holds it: open, late, waiting, done. */
const holdings: Dataset = {
  name: 'holdings',
  description: 'What is in progress, one row per holding: open, late, waiting, done and when.',
  permission: 'objects:read',
  row: row({
    opened_on: 'string',
    done_on: 'string',
    open: 'number',
    late: 'number',
    waiting: 'number',
    done: 'number',
    done_in_time: 'number',
    object_kind: 'string',
    project_id: 'string',
    party_id: 'string',
    unit_id: 'string',
    person_id: 'string',
  }),
  time: 'opened_on',
  measures: ['open', 'late', 'waiting', 'done', 'done_in_time'],
  dimensions: ['object_kind'],
  axes: { ...AXES, object: { kind: 'holding', field: 'object_kind' } },
};

/** The money the apps said: invoiced, received, committed, spent. */
const money: Dataset = {
  name: 'money',
  description: 'The money facts the apps said, one row per fact: its kind, amount and project.',
  permission: 'money:read',
  row: row({
    occurred_on: 'string',
    month: 'string',
    kind: 'string',
    amount: 'number',
    post: 'string',
    project_id: 'string',
    party_id: 'string',
    unit_id: 'string',
  }),
  time: 'occurred_on',
  measures: ['amount'],
  dimensions: ['month', 'kind', 'post'],
  axes: { project: 'project_id', party: 'party_id', unit: 'unit_id' },
};

/** The assets the organization keeps, and their state now. */
const assets: Dataset = {
  name: 'assets',
  description: 'The assets, one row each: in service, in alert, out of service, now.',
  permission: 'objects:read',
  row: row({
    state: 'string',
    subtype: 'string',
    in_service: 'number',
    alert: 'number',
    out_of_service: 'number',
    project_id: 'string',
    party_id: 'string',
    unit_id: 'string',
    person_id: 'string',
  }),
  measures: ['in_service', 'alert', 'out_of_service'],
  dimensions: ['state', 'subtype'],
  axes: AXES,
};

export const centerDatasets: readonly Dataset[] = [holdings, money, assets];

/**
 * The rows of one of the center's sources she may count, within a period when it has one: at most
 * MAX_ROWS and one, so that the engine says when it was cut.
 */
export async function centerRows(
  db: SqlExecutor,
  identity: Identity,
  name: string,
  period: { from?: string | undefined; to?: string | undefined },
): Promise<DatasetRow[] | null> {
  const sight = await sightOf(db, identity, await kindsOf(db));
  // $1 from, $2 to, $3 the limit, $4 her own id, $5 whether she reads the organization's own
  // money; her sight's parameters after.
  const seen = sightSql(sight, 6);
  const ownMoney = sight.admin || (await reach(db, identity, 'money:read')).everywhere;
  const params = [
    period.from ?? null,
    period.to ?? null,
    MAX_ROWS + 1,
    identity.userId,
    ownMoney,
    ...seen.params,
  ];
  if (name === 'holdings') {
    const { rows } = await db.query<DatasetRow>(
      `select to_char(h.since, 'YYYY-MM-DD') as opened_on,
              to_char(h.done_at, 'YYYY-MM-DD') as done_on,
              (h.state <> 'done')::int as open,
              (h.state <> 'done' and h.due < current_date)::int as late,
              (h.state = 'waiting')::int as waiting,
              (h.state = 'done')::int as done,
              (h.state = 'done' and (h.due is null or h.done_at::date <= h.due))::int as done_in_time,
              h.object_kind, o.project_id, o.party_id, o.unit_id, h.holder_id as person_id
         from kete_holdings h
         left join kete_objects o on o.kind = h.object_kind and o.object_id = h.object_id
        where ($1::date is null or h.since::date >= $1::date)
          and ($2::date is null or h.since::date <= $2::date)
          and (h.holder_id = $4 or (o.kind is not null and ${seen.sql})) and ($5 or true)
        limit $3`,
      params,
    );
    return rows;
  }
  if (name === 'money') {
    // Money with no project is the organization's own running: an administrator's, or money:read.
    const { rows } = await db.query<DatasetRow>(
      `select to_char(m.occurred_on, 'YYYY-MM-DD') as occurred_on,
              to_char(m.occurred_on, 'YYYY-MM') as month, m.kind, m.amount::float8 as amount,
              m.post, m.project_id, m.party_id, o.unit_id
         from money_facts m
         left join kete_objects o on o.kind = 'project' and o.object_id = m.project_id
        where ($1::date is null or m.occurred_on >= $1::date)
          and ($2::date is null or m.occurred_on <= $2::date)
          and ((o.kind is not null and ${seen.sql}) or ($5 and o.kind is null))
          and ($4::text is not null)
        limit $3`,
      params,
    );
    return rows;
  }
  if (name === 'assets') {
    const { rows } = await db.query<DatasetRow>(
      `select o.state, a.subtype,
              (o.state = 'in_service')::int as in_service, (o.state = 'alert')::int as alert,
              (o.state = 'out_of_service')::int as out_of_service,
              o.project_id, o.party_id, o.unit_id, o.person_id
         from kete_objects o join assets a on a.asset_id = o.object_id
        where o.kind = 'asset' and o.state <> 'retired'
          and ($1::date is null or true) and ($2::date is null or true)
          and ($4::text is not null) and ($5 or true)
          and ${seen.sql}
        limit $3`,
      params,
    );
    return rows;
  }
  return null;
}
