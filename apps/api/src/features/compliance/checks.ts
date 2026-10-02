import type { SqlExecutor } from '@kete/tenancy';

/** What an automatic check found: the evidence's outcome and the items behind it. */
export interface CheckResult {
  outcome: 'pass' | 'fail';
  details: { count: number; items: string[] };
}

type Check = (db: SqlExecutor) => Promise<CheckResult>;

const result = (items: string[]): CheckResult => ({
  outcome: items.length === 0 ? 'pass' : 'fail',
  details: { count: items.length, items: items.slice(0, 50) },
});

/**
 * Automatic checks read what the company already records (D-040: evidence comes from the journals
 * and the registers), inside the organization's transaction. Each answers one question.
 */
const checks: Record<string, Check> = {
  // Every active app and MCP server has an identity card that names its owner.
  'registry.apps_have_card': async (db) => {
    const { rows } = await db.query<{ name: string }>(
      `select name from resources
        where status = 'active' and kind in ('app', 'mcp')
          and coalesce(card -> 'governance' -> 'owner' ->> 'name', '') = ''
        order by name`,
    );
    return result(rows.map((r) => r.name));
  },
  // No approval step waits longer than its circuit allows.
  'decisions.no_overdue': async (db) => {
    const { rows } = await db.query<{ title: string }>(
      `select r.title from decision_requests r
         join decision_steps s on s.request_id = r.request_id and s.status = 'pending'
         join circuits c on c.circuit_id = r.circuit_id
        where r.status = 'pending' and s.entered_at is not null
          and s.entered_at + make_interval(hours => c.remind_after_hours) < now()
        order by r.title`,
    );
    return result(rows.map((r) => r.title));
  },
  // Every active position's agent has someone to act for.
  'agents.act_for_someone': async (db) => {
    const { rows } = await db.query<{ name: string }>(
      `select g.name from agents g
        where g.status = 'active' and g.kind = 'position'
          and not exists (
            select 1 from assignments a join people pe on pe.person_id = a.person_id
             where a.position_id = g.position_id and pe.account_user_id is not null
               and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date))
        order by g.name`,
    );
    return result(rows.map((r) => r.name));
  },
  // Every open position is held today.
  'structure.positions_filled': async (db) => {
    const { rows } = await db.query<{ title: string }>(
      `select p.title from positions p
        where p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)
          and not exists (
            select 1 from assignments a where a.position_id = p.position_id
               and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date))
        order by p.title`,
    );
    return result(rows.map((r) => r.title));
  },
  // No corrective action is past its due date and still open.
  'compliance.actions_on_time': async (db) => {
    const { rows } = await db.query<{ description: string }>(
      `select description from corrective_actions
        where status = 'open' and due_on < current_date order by due_on`,
    );
    return result(rows.map((r) => r.description));
  },
  // ISO 9001 § 9.3: a management review held and recorded in the last six months (spec 013).
  'meetings.management_review_held': async (db) => {
    const { rows } = await db.query<{ held: boolean }>(
      `select exists (
         select 1 from meetings m join meeting_types t on t.type_id = m.type_id
          where t.kind = 'quality' and m.status = 'recorded'
            and m.recorded_at > now() - interval '6 months') as held`,
    );
    return result(rows[0]?.held ? [] : ['management review']);
  },
  // Every meeting held in the last 90 days published its record within its type's delay.
  'meetings.records_on_time': async (db) => {
    const { rows } = await db.query<{ title: string }>(
      `select title from meetings
        where held_at > now() - interval '90 days'
          and ((status = 'recorded' and recorded_at > record_due_at)
               or (status = 'held' and record_due_at < now()))
        order by held_at`,
    );
    return result(rows.map((r) => r.title));
  },
  // ISO 9001 § 10.2: no action of the register past its date and still open (spec 013).
  'actions.on_time': async (db) => {
    const { rows } = await db.query<{ title: string }>(
      `select title from actions where status = 'open' and due_on < current_date order by due_on`,
    );
    return result(rows.map((r) => r.title));
  },
  // ISO 9001 § 7.2: in the last closed quarter, every person's review was held (spec 012).
  'performance.reviews_held': async (db) => {
    const { rows } = await db.query<{ name: string }>(
      `select pe.name from reviews r join people pe on pe.person_id = r.person_id
        where r.status = 'missed' and r.quarter_id = (
          select quarter_id from performance_quarters where status = 'closed'
           order by ends_on desc limit 1)
        order by pe.name`,
    );
    return result(rows.map((r) => r.name));
  },
  // ISO 9001 § 9.1.2: customer satisfaction measured in the last six months (spec 011).
  'surveys.customers_heard': async (db) => {
    const { rows } = await db.query<{ heard: boolean }>(
      `select exists (
         select 1 from survey_campaigns
          where audience ->> 'kind' = 'outside' and status = 'published'
            and published_at > now() - interval '6 months') as heard`,
    );
    return result(rows[0]?.heard ? [] : ['customer satisfaction']);
  },
};

export function knownChecks(): string[] {
  return Object.keys(checks).sort();
}

export function runCheck(db: SqlExecutor, key: string): Promise<CheckResult> | null {
  const check = checks[key];
  return check ? check(db) : null;
}
