import type { SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import { GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { failedTasksSince } from '../agents/index.js';
import { feedbackShare } from '../assistant/index.js';
import { isAdministrator } from '../rights/index.js';
import { failedRunsSince } from '../routines/index.js';
import { readChartAt } from '../structure/index.js';

// The organization's governance of AI (spec 054): what it spent this month, team by team; whether
// its people found the answers useful; what failed; and the journal of what the AI did — who, for
// whom, through which channel — exported as it is. For administrators.

export interface TeamUsage {
  unitId: string | null;
  unit: string | null;
  calls: number;
  tokens: number;
  people: number;
}
export interface JournalLine {
  at: string;
  actor: string;
  actorKind: string;
  onBehalfOf: string | null;
  channel: string;
  command: string;
  summary: string | null;
  reversible: boolean;
}

/** Each account's team today: the unit of the position its person holds. */
async function teamsOfAccounts(
  db: SqlExecutor,
): Promise<Map<string, { unitId: string; unit: string }>> {
  const chart = await readChartAt(db, new Date().toISOString().slice(0, 10));
  const unitOfPosition = new Map(chart.positions.map((p) => [p.positionId, p.unitId]));
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));
  const unitOfPerson = new Map<string, string>();
  for (const h of chart.holders) {
    const unitId = unitOfPosition.get(h.positionId);
    if (h.personId && unitId && !unitOfPerson.has(h.personId)) unitOfPerson.set(h.personId, unitId);
  }
  const teams = new Map<string, { unitId: string; unit: string }>();
  for (const person of chart.people) {
    const unitId = unitOfPerson.get(person.personId);
    if (person.accountUserId && unitId) {
      teams.set(person.accountUserId, { unitId, unit: unitName.get(unitId) ?? unitId });
    }
  }
  return teams;
}

const monthStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

export async function governanceOf(db: SqlExecutor): Promise<{
  since: string;
  teams: TeamUsage[];
  feedback: { helpful: number; judged: number };
  failures: { tasks: number; routines: number };
}> {
  const since = monthStart();
  const { rows } = await db.query<{ user_id: string | null; calls: string; tokens: string }>(
    `select coalesce(on_behalf_of_id, actor_id) as user_id, count(*) as calls,
            sum(input_tokens + output_tokens) as tokens
       from kete_ai_usage where created_at >= $1
      group by coalesce(on_behalf_of_id, actor_id)`,
    [since],
  );
  const teams = await teamsOfAccounts(db);
  const byUnit = new Map<string, TeamUsage>();
  for (const r of rows) {
    const team = r.user_id ? teams.get(r.user_id) : undefined;
    const key = team?.unitId ?? '';
    const line = byUnit.get(key) ?? {
      unitId: team?.unitId ?? null,
      unit: team?.unit ?? null,
      calls: 0,
      tokens: 0,
      people: 0,
    };
    line.calls += Number(r.calls);
    line.tokens += Number(r.tokens);
    line.people += 1;
    byUnit.set(key, line);
  }
  return {
    since: since.toISOString(),
    teams: [...byUnit.values()].sort((a, b) => b.tokens - a.tokens),
    feedback: await feedbackShare(db, since),
    failures: {
      tasks: await failedTasksSince(db, since),
      routines: await failedRunsSince(db, since),
    },
  };
}

/** What the AI did — its assistants and agents — the latest first, as the journal keeps it. */
export async function aiJournal(db: SqlExecutor, limit: number): Promise<JournalLine[]> {
  const { rows } = await db.query<{
    created_at: Date;
    actor_id: string;
    actor_kind: string;
    on_behalf_of_id: string | null;
    channel: string;
    name: string;
    summary: string | null;
    reversible: boolean;
  }>(
    `select created_at, actor_id, actor_kind, on_behalf_of_id, channel, name, summary, reversible
       from kete_commands where actor_kind = 'agent'
      order by created_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    at: r.created_at.toISOString(),
    actor: r.actor_id,
    actorKind: r.actor_kind,
    onBehalfOf: r.on_behalf_of_id,
    channel: r.channel,
    command: r.name,
    summary: r.summary,
    reversible: r.reversible,
  }));
}

/** The governance of AI, under /v1/governance — administrators only. */
export const governanceRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity) || c.get('viewedBy')) {
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    }
    return c.json(await transaction(identity.organizationId, (db) => governanceOf(db)));
  })
  .get('/journal', async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity) || c.get('viewedBy')) {
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    }
    const limit = Math.min(1000, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
    return c.json({
      lines: await transaction(identity.organizationId, (db) => aiJournal(db, limit)),
    });
  });
