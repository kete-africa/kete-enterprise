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
};

export function knownChecks(): string[] {
  return Object.keys(checks).sort();
}

export function runCheck(db: SqlExecutor, key: string): Promise<CheckResult> | null {
  const check = checks[key];
  return check ? check(db) : null;
}
