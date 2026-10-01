import { defineCommand } from '@kete/commands';
import { z } from 'zod';
import { registerAgent } from '../registry/index.js';
import {
  agentStatusInput,
  closeSignalInput,
  createAgentInput,
  raiseSignalInput,
} from './agents.record.js';
import {
  closeSignal,
  findAgent,
  findSignal,
  insertAgent,
  insertSignal,
  setStatus,
} from './infrastructure/agents.tables.js';

/** A rule of the agents was not met: the change is refused, nothing is written. */
export class AgentRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'unknown_watch' | 'closed',
    message: string,
  ) {
    super(message);
    this.name = 'AgentRuleError';
  }
}

export const createAgent = defineCommand({
  name: 'create-agent',
  // The watches that exist: the API says so, from the features that declare them.
  input: z.intersection(createAgentInput, z.object({ knownWatches: z.array(z.string()) })),
  reversibility: { reversible: true, inverse: 'update-agent-status' },
  async handler(input, { db, organizationId, actor }) {
    const unknown = input.watches.filter((w) => !input.knownWatches.includes(w));
    if (unknown.length > 0) {
      throw new AgentRuleError('unknown_watch', `Unknown watches: ${unknown.join(', ')}`);
    }
    const creator = actor.onBehalfOf?.id ?? actor.id;
    try {
      const agent = await insertAgent(db, organizationId, {
        ...input,
        responsibleUserId: input.kind === 'position' ? null : (input.responsibleUserId ?? creator),
        positionId: input.positionId ?? null,
        scopeUnitId: input.scopeUnitId ?? null,
      });
      // Every agent is known: it enters the registry, in the space of the person who answers for it.
      const resourceId = await registerAgent(db, organizationId, {
        name: agent.name,
        mission: agent.mission,
        ownerUserId: agent.responsibleUserId ?? creator,
      });
      return { ...agent, resourceId };
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new AgentRuleError('not_found', 'That position or unit does not exist here.');
      }
      throw error;
    }
  },
  summarize: (input) => `Agent "${input.name}" created (${input.kind})`,
});

export const updateAgentStatus = defineCommand({
  name: 'update-agent-status',
  input: agentStatusInput,
  reversibility: { reversible: true, inverse: 'update-agent-status' },
  async handler(input, { db }) {
    const agent = await findAgent(db, input.agentId);
    if (!agent) throw new AgentRuleError('not_found', 'The agent does not exist here.');
    await setStatus(db, input.agentId, input.status);
    return { agentId: input.agentId, before: agent.status, status: input.status };
  },
  summarize: (input) => `Agent ${input.agentId} is now ${input.status}`,
});

/** Level 1: an agent says what it found; it changes nothing else. */
export const raiseSignal = defineCommand({
  name: 'raise-signal',
  input: raiseSignalInput,
  reversibility: { reversible: true, inverse: 'close-signal' },
  handler: (input, { db, organizationId }) => insertSignal(db, organizationId, input),
  summarize: (input) => `Signal ${input.kind}: ${input.subject}`,
});

export const closeSignalCommand = defineCommand({
  name: 'close-signal',
  input: closeSignalInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const signal = await findSignal(db, input.signalId);
    if (!signal) throw new AgentRuleError('not_found', 'The signal does not exist here.');
    if (signal.closedAt) throw new AgentRuleError('closed', 'This signal is already closed.');
    await closeSignal(db, input.signalId, input.reason, actor.id);
    return { signalId: input.signalId, reason: input.reason };
  },
  summarize: (input) => `Signal ${input.signalId} closed (${input.reason})`,
});
