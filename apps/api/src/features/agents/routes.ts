import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { reach } from '../rights/index.js';
import type { Agent } from './agents.record.js';
import { AgentRuleError, closeSignalCommand, createAgent, updateAgentStatus } from './commands.js';
import {
  findAgent,
  findSignal,
  listAgents,
  openSignals,
  personOfAgent,
} from './infrastructure/agents.tables.js';
import { wakeAgent } from './wake.js';
import { knownWatches } from './watches.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 007). */
export const agentsPermissions = ['agents:manage'] as const;

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Response> {
  try {
    return c.json(await runGesture(c, definition, input), 201);
  } catch (error) {
    if (error instanceof AgentRuleError) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 409, error.code, error.message);
    }
    throw error;
  }
}

const forbidden = () =>
  new GestureRefusal(
    403,
    'forbidden',
    'Only the person an agent acts for, or a manager of agents.',
  );

async function manages(c: Ctx, db: SqlExecutor): Promise<boolean> {
  return (await reach(db, c.get('identity'), 'agents:manage')).everywhere;
}

/** The agent, if the person may act on it: it acts for her, or she manages agents. */
async function ownAgent(c: Ctx, db: SqlExecutor, agentId: string): Promise<Agent> {
  const agent = await findAgent(db, agentId);
  if (!agent) throw new GestureRefusal(404, 'not_found', 'No such agent here.');
  const actsFor = await personOfAgent(db, agent);
  if (actsFor !== c.get('identity').userId && !(await manages(c, db))) throw forbidden();
  return agent;
}

/**
 * The agents' routes, under /v1/agents (spec 007). `permissions` is the catalog: an agent's job
 * description lists only permissions that exist.
 */
export function agentsRoutes(permissions: readonly string[]) {
  const known = new Set(permissions);
  return (
    new Hono<{ Variables: IdentityVariables }>()
      // The agents that act for the person (all of them for a manager), with their open signals.
      .get('/', async (c) => {
        const identity = c.get('identity');
        const screen = await transaction(identity.organizationId, async (db) => {
          const all = await manages(c, db);
          const agents = [];
          for (const agent of await listAgents(db)) {
            const actsFor = await personOfAgent(db, agent);
            if (!all && actsFor !== identity.userId) continue;
            agents.push({ ...agent, actsFor, signals: await openSignals(db, agent.agentId) });
          }
          return { agents, watches: knownWatches(), manages: all };
        });
        return c.json(screen);
      })
      // A person creates her own agent; a position's or the system's needs a manager of agents.
      .post('/', async (c) => {
        const identity = c.get('identity');
        const input = (await bodyOf(c)) as Record<string, unknown>;
        const own =
          input['kind'] === 'personal' &&
          (input['responsibleUserId'] === undefined ||
            input['responsibleUserId'] === identity.userId);
        if (!own && !(await transaction(identity.organizationId, (db) => manages(c, db)))) {
          throw forbidden();
        }
        const asked = Array.isArray(input['permissions']) ? input['permissions'] : [];
        const unknown = asked.filter((p) => typeof p === 'string' && !known.has(p));
        if (unknown.length > 0) {
          throw new GestureRefusal(422, 'unknown_permission', `Unknown: ${unknown.join(', ')}`);
        }
        return run(c, createAgent, { ...input, knownWatches: knownWatches() });
      })
      .post('/:agentId/status', async (c) => {
        const agentId = c.req.param('agentId');
        await transaction(c.get('identity').organizationId, (db) => ownAgent(c, db, agentId));
        return run(c, updateAgentStatus, { ...((await bodyOf(c)) as object), agentId });
      })
      // Wakes the agent now, rather than at its next round.
      .post('/:agentId/wake', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId } = c.get('identity');
        await transaction(organizationId, (db) => ownAgent(c, db, agentId));
        return c.json(await wakeAgent(organizationId, agentId), 201);
      })
      // The person the agent acts for resolves its signal.
      .post('/signals/:signalId/close', async (c) => {
        const signalId = c.req.param('signalId');
        const { organizationId } = c.get('identity');
        await transaction(organizationId, async (db) => {
          const signal = await findSignal(db, signalId);
          if (!signal) throw new GestureRefusal(404, 'not_found', 'No such signal here.');
          await ownAgent(c, db, signal.agentId);
        });
        return run(c, closeSignalCommand, { signalId, reason: 'resolved' });
      })
  );
}
