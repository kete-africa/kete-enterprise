import { defineCommand } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { standingMandates } from '../../platform/mandates.js';
import { AgentRuleError } from './commands.js';

// An agent acts while its person is away (spec 108; kete-core spec 150): a routine or an event it
// follows wakes it when she is not there, with no token of hers to exchange for a mandate. Once,
// signed in, she lets it act for her in her absence: the Compte Kete keeps a standing mandate, and
// its grant is written on the agent. At each task the agent asks the Compte Kete for its mandate of
// now — her rights as they are now — and reaches the apps its job description names. Withdrawn
// here or in Mon espace Kete, it reaches them no more.

/** What she gave: the grant the Compte Kete keeps, for whom, since when. */
export interface Away {
  grant: string;
  userId: string;
  at: string;
}

/** An agent's standing mandate, kept on the agent (spec 108). */
export function agentAwayMigrationSql(options: { schema: string }): string {
  return `alter table ${options.schema}.agents
  add column away jsonb check (away is null or (away ? 'grant' and away ? 'user_id'));`;
}

export async function awayOf(db: SqlExecutor, agentId: string): Promise<Away | null> {
  const { rows } = await db.query<{
    away: { grant: string; user_id: string; at: string } | null;
  }>(`select away from agents where agent_id = $1`, [agentId]);
  const away = rows[0]?.away;
  return away ? { grant: away.grant, userId: away.user_id, at: away.at } : null;
}

const agentId = z.string().regex(/^agt_[\w-]{1,64}$/);

/** She lets it act for her while she is away: the grant the Compte Kete gave, on the agent. */
export const giveAgentAway = defineCommand({
  name: 'give-agent-away',
  input: z.object({
    agentId,
    grant: z.string().regex(/^smd_[\w-]{4,64}$/),
    userId: z.string().min(1).max(128),
  }),
  reversibility: { reversible: true, inverse: 'take-agent-away' },
  async handler(input, { db }) {
    const { rows } = await db.query(
      `update agents set away = jsonb_build_object('grant', $2::text, 'user_id', $3::text,
         'at', now()) where agent_id = $1 returning agent_id`,
      [input.agentId, input.grant, input.userId],
    );
    if (rows.length === 0) throw new AgentRuleError('not_found', 'No such agent here.');
    return { agentId: input.agentId, away: true };
  },
  summarize: (input) => `Agent ${input.agentId} acts while its person is away`,
});

/** It no longer acts for her while she is away; the grant it held is answered, to withdraw. */
export const takeAgentAway = defineCommand({
  name: 'take-agent-away',
  input: z.object({ agentId }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const before = await awayOf(db, input.agentId);
    await db.query(`update agents set away = null where agent_id = $1`, [input.agentId]);
    return { agentId: input.agentId, grant: before?.grant ?? null };
  },
  summarize: (input) => `Agent ${input.agentId} no longer acts while its person is away`,
});

/**
 * The mandate the agent carries to the apps while she is away: null when she gave none, when it
 * now acts for someone else, or when the Compte Kete refuses (withdrawn there, she has left).
 */
export async function awayMandate(
  organizationId: string,
  away: Away | null,
  userId: string,
): Promise<string | null> {
  if (!away || away.userId !== userId) return null;
  return (await standingMandates()?.token(organizationId, away.grant)) ?? null;
}

/** The products among an agent's sources: the apps it may reach while she is away. */
export const productsOf = (sources: readonly string[]): string[] =>
  sources.filter((source) => source.startsWith('prd_'));
