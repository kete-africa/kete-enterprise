import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { standingMandates } from '../../platform/mandates.js';
import { readModules } from '../organization/index.js';
import { isAdministrator, reach, reachesAnything, unitsOfPersonAndAbove } from '../rights/index.js';
import { giveAgentAway, takeAgentAway } from './away.js';
import { budgetOf, setAgentBudget } from './budget.js';
import {
  appNamesOf,
  catalogueOf,
  enableAgentTemplate,
  takeAgentTemplate,
  wakesOf,
} from './catalogue.js';
import { askEvaluation, evaluationsOf, THRESHOLD, writeEvalCase } from './evaluations.js';
import { dryRunInput, type Agent } from './agents.record.js';
import {
  AgentRuleError,
  closeSignalCommand,
  createAgent,
  setAgentAutonomy,
  shareAgent,
  updateAgentStatus,
} from './commands.js';
import {
  findAgent,
  findSignal,
  listAgents,
  openSignals,
  personOfAgent,
} from './infrastructure/agents.tables.js';
import { agentRecord, NoAgentModelError, understandAgent } from './record.js';
import { findingsOf, wakeAgent } from './wake.js';
import { knownWatches } from './watches.js';
import { howOf } from './how.js';
import {
  childrenOf,
  getTask,
  giveTaskInput,
  givenToShared,
  pauseTask,
  queueTask,
  resumeTask,
  stateOfAgent,
  stopTask,
  takeOverTask,
  tasksOf,
  writeToTask,
  type AgentTask,
  type Steerer,
} from './tasks.js';

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

/** Whether a shared agent is open to the person: to everyone, or to a unit she is in or under. */
async function openTo(c: Ctx, db: SqlExecutor, agent: Agent): Promise<boolean> {
  if (agent.visibility !== 'shared' || agent.status !== 'active') return false;
  if (agent.sharedWith.length === 0) return true;
  const units = await unitsOfPersonAndAbove(db, c.get('identity'));
  return agent.sharedWith.some((unitId) => units.has(unitId));
}

/** The agent, if the person may give it work: hers, one she manages, or one shared with her. */
async function callableAgent(c: Ctx, db: SqlExecutor, agentId: string): Promise<Agent> {
  const agent = await findAgent(db, agentId);
  if (!agent) throw new GestureRefusal(404, 'not_found', 'No such agent here.');
  if (await openTo(c, db, agent)) return agent;
  return ownAgent(c, db, agentId);
}

/** The task, if the person may follow and steer it: she gave it, or its agent is hers. */
async function followedTask(c: Ctx, db: SqlExecutor, taskId: string): Promise<AgentTask> {
  const task = await getTask(db, taskId);
  if (!task) throw new GestureRefusal(404, 'not_found', 'No such task here.');
  if (task.givenBy !== c.get('identity').userId) await ownAgent(c, db, task.agentId);
  return task;
}

const steerer = (c: Ctx): Steerer => {
  const { userId, name } = c.get('identity');
  return { userId, name: name || userId };
};

/** One gesture on a task she follows; 409 when the task is no longer in a state that takes it. */
async function steer(
  c: Ctx,
  gesture: (db: SqlExecutor, task: AgentTask) => Promise<boolean>,
): Promise<Response> {
  if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to steer.');
  const { organizationId } = c.get('identity');
  const task = await transaction(organizationId, async (db) => {
    const followed = await followedTask(c, db, c.req.param('taskId') ?? '');
    if (!(await gesture(db, followed))) {
      throw new GestureRefusal(409, 'task_settled', 'This task no longer takes it.');
    }
    return getTask(db, followed.taskId);
  });
  return c.json({ task });
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
          const on = (await readModules(db)).agents;
          const agents = [];
          // Shared with her by a colleague (D-044): what it is for, never how it is set.
          const shared = [];
          for (const agent of await listAgents(db)) {
            const actsFor = await personOfAgent(db, agent);
            if (actsFor !== identity.userId && (await openTo(c, db, agent))) {
              shared.push({ agentId: agent.agentId, name: agent.name, mission: agent.mission });
            }
            if (!all && actsFor !== identity.userId) continue;
            agents.push({
              ...agent,
              actsFor,
              signals: await openSignals(db, agent.agentId),
              state: await stateOfAgent(db, agent, on),
            });
          }
          return { agents, shared, watches: knownWatches(), manages: all };
        });
        return c.json(screen);
      })
      // The catalogue (spec 104): the agents Kete and the apps ship, those open here, hers to take.
      .get('/catalogue', async (c) => {
        const identity = c.get('identity');
        return c.json(
          await transaction(identity.organizationId, async (db) => {
            const admin = isAdministrator(identity);
            const entries = (await catalogueOf(db)).filter((e) => admin || e.enabled);
            return {
              entries: await Promise.all(
                entries.map(async (e) => ({ ...e, wakes: await wakesOf(db, e.template) })),
              ),
              apps: await appNamesOf(db),
              administrator: admin,
            };
          }),
        );
      })
      .post('/catalogue/:product/:name/enable', async (c) => {
        const identity = c.get('identity');
        if (!isAdministrator(identity)) {
          throw new GestureRefusal(403, 'forbidden', 'An administrator opens the catalogue.');
        }
        const body = (await bodyOf(c)) as { enabled?: unknown };
        return run(c, enableAgentTemplate, {
          product: c.req.param('product'),
          name: c.req.param('name'),
          enabled: body?.enabled !== false,
          by: identity.userId,
        });
      })
      .post('/catalogue/:product/:name/take', async (c) => {
        if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to take.');
        return run(c, takeAgentTemplate, {
          product: c.req.param('product'),
          name: c.req.param('name'),
        });
      })
      // A personal agent's job description from her sentence (spec 052): nothing created yet.
      .post('/understand', async (c) => {
        if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to ask.');
        const sentence = ((await bodyOf(c)) as { sentence?: unknown } | null)?.sentence;
        if (typeof sentence !== 'string' || sentence.trim().length < 3 || sentence.length > 1000) {
          throw new GestureRefusal(422, 'invalid_input', 'A sentence.');
        }
        const identity = c.get('identity');
        const held = await transaction(identity.organizationId, async (db) => {
          const mine: string[] = [];
          for (const permission of permissions) {
            if (reachesAnything(await reach(db, identity, permission))) mine.push(permission);
          }
          return mine;
        });
        try {
          const proposal = await understandAgent(identity, sentence.trim(), {
            watches: knownWatches(),
            permissions: held,
          });
          if (!proposal) throw new GestureRefusal(422, 'not_understood', 'It would watch nothing.');
          return c.json({ proposal });
        } catch (error) {
          if (error instanceof NoAgentModelError) {
            throw new GestureRefusal(409, 'assistant_unavailable', 'No model configured.');
          }
          throw error;
        }
      })
      // Its dry run (spec 067): what this job description would signal today — exactly what its
      // first round would raise, read with her rights. Nothing is created, nothing is written.
      .post('/dry-run', async (c) => {
        const parsed = dryRunInput.safeParse(await bodyOf(c));
        if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What it watches.');
        const identity = c.get('identity');
        const watching = new Set(knownWatches());
        const found = await transaction(identity.organizationId, (db) =>
          findingsOf(db, identity.userId, {
            watches: parsed.data.watches.filter((watch) => watching.has(watch)),
            permissions: parsed.data.permissions.filter((permission) => known.has(permission)),
            scopeUnitId: parsed.data.scopeUnitId ?? null,
          }),
        );
        return c.json({
          findings: [...found.values()].map(({ watch, finding }) => ({
            watch,
            kind: finding.kind,
            subject: finding.subject,
          })),
        });
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
      // Its level for one kind of task (spec 052): its person or a manager of agents sets it.
      .post('/:agentId/autonomy', async (c) => {
        const agentId = c.req.param('agentId');
        await transaction(c.get('identity').organizationId, (db) => ownAgent(c, db, agentId));
        return run(c, setAgentAutonomy, { ...((await bodyOf(c)) as object), agentId });
      })
      // Private or shared (spec 066, D-044): its person alone opens it, and chooses to whom.
      .post('/:agentId/sharing', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId, userId } = c.get('identity');
        await transaction(organizationId, async (db) => {
          const agent = await ownAgent(c, db, agentId);
          if ((await personOfAgent(db, agent)) !== userId) throw forbidden();
        });
        return run(c, shareAgent, { ...((await bodyOf(c)) as object), agentId });
      })
      // While she is away (spec 108; kete-core spec 150): she lets her agent act for her, signed
      // in — her token is her consent to the Compte Kete — or takes it back, here or there.
      .post('/:agentId/away', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId, userId } = c.get('identity');
        const body = (await bodyOf(c)) as { away?: unknown } | null;
        if (typeof body?.away !== 'boolean') {
          throw new GestureRefusal(422, 'invalid_input', 'Away: true or false.');
        }
        if (!body.away) {
          await transaction(organizationId, (db) => ownAgent(c, db, agentId));
          const taken = await runGesture(c, takeAgentAway, { agentId });
          // Withdrawn at the Compte Kete too; if it does not answer, the grant left is unused.
          if (taken.grant) {
            await standingMandates()
              ?.revoke(organizationId, taken.grant)
              .catch(() => false);
          }
          return c.json({ agentId, away: false });
        }
        if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to give.');
        const agent = await transaction(organizationId, async (db) => {
          const found = await ownAgent(c, db, agentId);
          if ((await personOfAgent(db, found)) !== userId) throw forbidden();
          return found;
        });
        const standing = standingMandates();
        if (!standing) {
          throw new GestureRefusal(409, 'mandates_off', 'Agents carry no mandate here yet.');
        }
        const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
        const grant = await standing.grant(token, { id: agent.agentId, name: agent.name });
        if (!grant) {
          throw new GestureRefusal(409, 'mandate_refused', 'The Compte Kete gave no mandate.');
        }
        return run(c, giveAgentAway, { agentId, grant, userId });
      })
      // What it did these last days (spec 052).
      // Its budget this month (spec 106): what it spent, its own limit, the organization's.
      .get('/:agentId/budget', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId } = c.get('identity');
        return c.json(
          await transaction(organizationId, async (db) => {
            await ownAgent(c, db, agentId);
            return budgetOf(db, agentId);
          }),
        );
      })
      .post('/:agentId/budget', async (c) => {
        const agentId = c.req.param('agentId');
        await transaction(c.get('identity').organizationId, (db) => ownAgent(c, db, agentId));
        const body = (await bodyOf(c)) as { monthlyTokens?: unknown };
        return run(c, setAgentBudget, { agentId, monthlyTokens: body?.monthlyTokens ?? null });
      })
      // How it proves itself (spec 106, R21): its last evaluations, one asked now, a case written.
      .get('/:agentId/evaluations', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId } = c.get('identity');
        return c.json(
          await transaction(organizationId, async (db) => {
            await ownAgent(c, db, agentId);
            return { evaluations: await evaluationsOf(db, agentId), threshold: THRESHOLD };
          }),
        );
      })
      .post('/:agentId/evaluations', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId } = c.get('identity');
        const evaluationId = await transaction(organizationId, async (db) => {
          await ownAgent(c, db, agentId);
          return askEvaluation(db, organizationId, agentId, 'asked');
        });
        return c.json({ evaluationId }, 202);
      })
      .post('/:agentId/cases', async (c) => {
        const agentId = c.req.param('agentId');
        await transaction(c.get('identity').organizationId, (db) => ownAgent(c, db, agentId));
        const body = (await bodyOf(c)) as object;
        return run(c, writeEvalCase, { ...body, agentId, by: c.get('identity').userId });
      })
      .get('/:agentId/record', async (c) => {
        const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 7) || 7));
        const { organizationId } = c.get('identity');
        return c.json(
          await transaction(organizationId, async (db) => {
            const agent = await ownAgent(c, db, c.req.param('agentId'));
            return { record: await agentRecord(db, agent, days) };
          }),
        );
      })
      // Wakes the agent now, rather than at its next round.
      .post('/:agentId/wake', async (c) => {
        const agentId = c.req.param('agentId');
        const { organizationId } = c.get('identity');
        await transaction(organizationId, (db) => ownAgent(c, db, agentId));
        return c.json(await wakeAgent(organizationId, agentId), 201);
      })
      // A task given to the agent (spec 036): it runs in the background, and she is told.
      .post('/:agentId/tasks', async (c) => {
        if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to give.');
        const parsed = giveTaskInput.safeParse(await bodyOf(c));
        if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'An instruction.');
        const identity = c.get('identity');
        const task = await transaction(identity.organizationId, async (db) => {
          const agent = await callableAgent(c, db, c.req.param('agentId'));
          if (agent.status !== 'active') {
            throw new GestureRefusal(409, 'agent_paused', 'This agent is paused.');
          }
          return queueTask(db, {
            organizationId: identity.organizationId,
            agentId: agent.agentId,
            givenBy: identity.userId,
            instruction: parsed.data.instruction,
          });
        });
        return c.json({ task }, 201);
      })
      .get('/:agentId/tasks', async (c) => {
        const { organizationId } = c.get('identity');
        return c.json({
          tasks: await transaction(organizationId, async (db) => {
            const agent = await ownAgent(c, db, c.req.param('agentId'));
            return tasksOf(db, agent.agentId);
          }),
        });
      })
      // What she asked of colleagues' shared agents (spec 066): hers to follow and steer.
      .get('/tasks/given', async (c) => {
        const { organizationId, userId } = c.get('identity');
        return c.json({
          tasks: await transaction(organizationId, (db) => givenToShared(db, userId)),
        });
      })
      // A task and the tasks it handed on: the whole of a delegated work.
      .get('/tasks/:taskId', async (c) => {
        const { organizationId } = c.get('identity');
        return c.json(
          await transaction(organizationId, async (db) => {
            const task = await followedTask(c, db, c.req.param('taskId'));
            return { task, handedOn: await childrenOf(db, task.taskId) };
          }),
        );
      })
      // « Comment ? » (spec 056): how it did it, from what was recorded — for whoever may see it.
      .get('/tasks/:taskId/how', async (c) => {
        const { organizationId } = c.get('identity');
        return c.json(
          await transaction(organizationId, async (db) => {
            const task = await followedTask(c, db, c.req.param('taskId'));
            const agent = await findAgent(db, task.agentId);
            if (!agent) throw new GestureRefusal(404, 'not_found', 'No such agent here.');
            return howOf(db, task, agent, c.get('identity').userId);
          }),
        );
      })
      .post('/tasks/:taskId/stop', async (c) => {
        const { organizationId } = c.get('identity');
        const stopped = await transaction(organizationId, async (db) => {
          const task = await followedTask(c, db, c.req.param('taskId'));
          return stopTask(db, task.taskId, steerer(c));
        });
        return c.json({ stopped });
      })
      // She steers it while it works (spec 066): pause, go on, write to it, take the work over.
      .post('/tasks/:taskId/pause', (c) =>
        steer(c, (db, task) => pauseTask(db, task.taskId, steerer(c))),
      )
      .post('/tasks/:taskId/resume', (c) => steer(c, (db, task) => resumeTask(db, task.taskId)))
      .post('/tasks/:taskId/write', async (c) => {
        const text = ((await bodyOf(c)) as { text?: unknown } | null)?.text;
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
          throw new GestureRefusal(422, 'invalid_input', 'A few words.');
        }
        return steer(c, (db, task) => writeToTask(db, task.taskId, steerer(c), text.trim()));
      })
      .post('/tasks/:taskId/take-over', (c) =>
        steer(c, (db, task) =>
          takeOverTask(db, c.get('identity').organizationId, task.taskId, steerer(c)),
        ),
      )
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
