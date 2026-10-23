import { defineCommand } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { sayHolding } from '@kete/work';
import { z } from 'zod';
import type { Agent } from './agents.record.js';

// An agent's budget (spec 106; doctrine D-062, R18; kete-core ADR 0018): its tokens this month,
// counted by the model calls it makes (`@kete/ai`'s journal), within its own monthly budget and the
// organization's. Spent, it waits: its person holds « demander plus », and whoever may raises it.

export interface AgentBudget {
  /** Its monthly budget in tokens; null: only the organization's. */
  monthlyTokens: number | null;
  /** What it spent since the first of the month. */
  spentTokens: number;
  /** What the organization's budget says, if it has one. */
  organizationTokens: number | null;
}

export async function budgetOf(db: SqlExecutor, agentId: string): Promise<AgentBudget> {
  const { rows } = await db.query<{
    agent: number | null;
    organization: number | null;
    spent: string | null;
  }>(
    `select
       (select monthly_tokens from kete_ai_budgets where scope_kind = 'agent' and scope_id = $1)
         as agent,
       (select monthly_tokens from kete_ai_budgets where scope_kind = 'organization' limit 1)
         as organization,
       (select sum(input_tokens + output_tokens) from kete_ai_usage
         where actor_kind = 'agent' and actor_id = $1 and created_at >= date_trunc('month', now()))
         as spent`,
    [agentId],
  );
  const row = rows[0];
  return {
    monthlyTokens: row?.agent ?? null,
    spentTokens: Number(row?.spent ?? 0),
    organizationTokens: row?.organization ?? null,
  };
}

/** Its monthly budget, set by its person or a manager of agents — or none, the organization's only. */
export const setAgentBudget = defineCommand({
  name: 'set-agent-budget',
  input: z.object({
    agentId: z.string().min(1).max(100),
    monthlyTokens: z.number().int().min(0).max(1_000_000_000).nullable(),
  }),
  reversibility: { reversible: true, inverse: 'set-agent-budget' },
  async handler(input, { db, organizationId }) {
    const before = await budgetOf(db, input.agentId);
    if (input.monthlyTokens === null) {
      await db.query(`delete from kete_ai_budgets where scope_kind = 'agent' and scope_id = $1`, [
        input.agentId,
      ]);
    } else {
      await db.query(
        `insert into kete_ai_budgets (organization_id, scope_kind, scope_id, monthly_tokens)
         values ($1, 'agent', $2, $3)
         on conflict (organization_id, scope_kind, scope_id) do update
           set monthly_tokens = excluded.monthly_tokens, updated_at = now()`,
        [organizationId, input.agentId, input.monthlyTokens],
      );
    }
    return { agentId: input.agentId, before: before.monthlyTokens, after: input.monthlyTokens };
  },
  summarize: (input) => `Budget of ${input.agentId}: ${input.monthlyTokens ?? 'none'}`,
});

/** Its budget spent: its person holds « demander plus », once a month, where she raises it. */
export async function budgetSpent(
  db: SqlExecutor,
  organizationId: string,
  agent: Agent,
  person: string,
  words: (name: string) => string,
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  await sayHolding(db, organizationId, {
    source: { app: 'agents', kind: 'budget', ref: `${agent.agentId}:${month}` },
    object: { kind: 'agent', id: agent.agentId },
    what: words(agent.name),
    holder: { kind: 'person', id: person },
    state: 'held',
    for: 'action',
    href: `/mes-agents?agent=${agent.agentId}`,
  });
}
