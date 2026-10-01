import { executeCommand, type Actor } from '@kete/commands';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../platform/db.js';
import type { Agent, Finding } from './agents.record.js';
import { closeSignalCommand, raiseSignal } from './commands.js';
import {
  dueAgents,
  findAgent,
  markRun,
  openSignals,
  personOfAgent,
  subtreeOf,
} from './infrastructure/agents.tables.js';
import { watchNamed } from './watches.js';

export interface WakeReport {
  agentId: string;
  /** False when nobody holds the agent's position: it cannot act for anyone. */
  acted: boolean;
  raised: number;
  closed: number;
}

/** The agent's actor: always acting for its person (D-039: the chain goes back to a human). */
const actorOf = (agent: Agent, userId: string): Actor => ({
  kind: 'agent',
  id: agent.agentId,
  channel: 'worker',
  onBehalfOf: { kind: 'person', id: userId },
});

/**
 * Wakes one agent: it runs its watches within its person's rights and its own scope and
 * permissions, raises a signal for each new problem, closes those that are solved, and sleeps
 * until its next wake. Everything it does is a named command in the journal.
 */
export async function wakeAgent(organizationId: string, agentId: string): Promise<WakeReport> {
  return transaction(organizationId, async (db) => {
    const agent = await findAgent(db, agentId);
    if (!agent || agent.status !== 'active') return { agentId, acted: false, raised: 0, closed: 0 };
    const userId = await personOfAgent(db, agent);
    if (!userId) {
      await markRun(db, agentId);
      return { agentId, acted: false, raised: 0, closed: 0 };
    }
    // The person's role at the Compte Kete is not known here: an agent never acts as an
    // administrator, only within the rights the structure gives its person.
    const person = { userId, role: null };
    const scope = agent.scopeUnitId ? await subtreeOf(db, agent.scopeUnitId) : null;
    const found = new Map<string, { watch: string; finding: Finding }>();
    for (const name of agent.watches) {
      const plugged = watchNamed(name);
      if (!plugged) continue;
      // An agent never holds more than its job description says.
      if (plugged.permission && !agent.permissions.includes(plugged.permission)) continue;
      for (const finding of await plugged.watch(db, person, scope)) {
        found.set(finding.key, { watch: name, finding });
      }
    }
    const actor = actorOf(agent, userId);
    const open = await openSignals(db, agentId);
    const openKeys = new Set(open.map((s) => s.key));
    let raised = 0;
    for (const [key, { watch, finding }] of found) {
      if (openKeys.has(key)) continue;
      await executeCommand(db, raiseSignal, {
        organizationId,
        actor,
        idempotencyKey: `raise-${randomUUID()}`,
        input: { agentId, watch, ...finding },
      });
      raised += 1;
    }
    let closed = 0;
    for (const signal of open.filter((s) => !found.has(s.key))) {
      await executeCommand(db, closeSignalCommand, {
        organizationId,
        actor,
        idempotencyKey: `close-${randomUUID()}`,
        input: { signalId: signal.signalId, reason: 'solved' },
      });
      closed += 1;
    }
    await markRun(db, agentId);
    return { agentId, acted: true, raised, closed };
  });
}

/** The worker's round: every agent due, each in its own organization (spec 007). */
export async function wakeDueAgents(
  listDue: () => Promise<{ organizationId: string; agentId: string }[]>,
): Promise<WakeReport[]> {
  const reports: WakeReport[] = [];
  for (const { organizationId, agentId } of await listDue()) {
    try {
      reports.push(await wakeAgent(organizationId, agentId));
    } catch (error) {
      // One agent's failure never stops the others; it wakes again at its next round.
      console.error(`agent ${agentId} could not wake`, error);
    }
  }
  return reports;
}

export { dueAgents };
