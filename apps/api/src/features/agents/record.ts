import { extract } from '@kete/ai';
import type { SqlExecutor } from '@kete/tenancy';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { IdentityVariables } from '../../platform/identity.js';
import { organizationLanguageModel } from '../../platform/models.js';
import { usageStore } from '../../platform/usage.js';
import type { Agent } from './agents.record.js';

// An agent's record and an agent from a sentence (spec 052): what it did these last days — its
// tasks, the drafts it prepared and what its person decided, its signals — and a job description
// the model proposes from what she says, within what she holds.

type Identity = IdentityVariables['identity'];

export interface AgentRecord {
  since: string;
  tasks: { done: number; failed: number; stopped: number; open: number };
  drafts: { validated: number; refused: number; open: number };
  signals: { raised: number; closed: number };
}

const countsOf = (rows: { status: string; n: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;

/** What the agent did since `days` ago. */
export async function agentRecord(
  db: SqlExecutor,
  agent: Agent,
  days: number,
): Promise<AgentRecord> {
  const since = new Date(Date.now() - days * 86_400_000);
  const tasks = countsOf(
    (
      await db.query<{ status: string; n: string }>(
        `select status, count(*) as n from agent_tasks
          where agent_id = $1 and created_at >= $2 group by status`,
        [agent.agentId, since],
      )
    ).rows,
  );
  const drafts = countsOf(
    (
      await db.query<{ status: string; n: string }>(
        `select status, count(*) as n from kete_drafts
          where prepared_by_id = $1 and created_at >= $2 group by status`,
        [agent.agentId, since],
      )
    ).rows,
  );
  const { rows } = await db.query<{ raised: string; closed: string }>(
    `select count(*) filter (where raised_at >= $2) as raised,
            count(*) filter (where closed_at >= $2) as closed
       from agent_signals where agent_id = $1`,
    [agent.agentId, since],
  );
  return {
    since: since.toISOString(),
    tasks: {
      done: tasks.done ?? 0,
      failed: tasks.failed ?? 0,
      stopped: tasks.stopped ?? 0,
      open: (tasks.queued ?? 0) + (tasks.running ?? 0),
    },
    drafts: {
      validated: drafts.validated ?? 0,
      refused: drafts.refused ?? 0,
      open: drafts.prepared ?? 0,
    },
    signals: { raised: Number(rows[0]?.raised ?? 0), closed: Number(rows[0]?.closed ?? 0) },
  };
}

const proposed = z.object({
  name: z.string().min(1).max(120),
  mission: z.string().min(1).max(2000),
  watches: z.array(z.string()).max(10),
  permissions: z.array(z.string()).max(50),
  autonomyMax: z.number().int().min(1).max(3),
  wakeEveryMinutes: z
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60),
  plan: z.array(z.string().min(1).max(200)).min(1).max(5),
});
export type AgentProposal = z.infer<typeof proposed>;

let modelOverride: LanguageModel | null | undefined;
/** Tests: understand with another model (`null`: as if none were configured). */
export function useAgentModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}
export class NoAgentModelError extends Error {}

/**
 * A personal agent's job description from her sentence: only watches that exist and permissions
 * she holds, a maximum level of 3 at most; null when it would watch nothing.
 */
export async function understandAgent(
  identity: Identity,
  sentence: string,
  choices: { watches: string[]; permissions: string[] },
): Promise<AgentProposal | null> {
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) throw new NoAgentModelError();
  const { value } = await extract({
    model,
    schema: proposed,
    system:
      'Tu proposes la fiche de poste d’un agent personnel, en français : un nom court, sa mission ' +
      'en une ou deux phrases, ce qu’il surveille (parmi la liste), les permissions dont il a ' +
      'besoin (parmi celles de la personne, le moins possible), son niveau maximum (1 lire, 2 agir ' +
      'quand on peut annuler, 3 préparer pour qu’elle décide), sa fréquence de réveil en minutes, ' +
      'et un plan de trois à cinq phrases : ce qu’il fera, avec ses droits à elle, ce qu’il ne fera ' +
      'jamais seul. N’invente ni surveillance ni permission hors des listes.',
    prompt: `Phrase : « ${sentence} »\n\nSurveillances possibles : ${choices.watches.join(', ') || '(aucune)'}\nSes permissions : ${choices.permissions.join(', ') || '(aucune)'}`,
    metering: {
      store: usageStore(),
      context: {
        organizationId: identity.organizationId,
        actor: {
          kind: 'agent',
          id: 'agt_assistant',
          channel: 'web',
          onBehalfOf: { kind: 'person', id: identity.userId },
        },
        purpose: 'agent-understanding',
        model: '',
      },
    },
  });
  const watches = [...new Set(value.watches.filter((w) => choices.watches.includes(w)))];
  if (watches.length === 0) return null;
  return {
    ...value,
    watches,
    permissions: [...new Set(value.permissions.filter((p) => choices.permissions.includes(p)))],
  };
}
