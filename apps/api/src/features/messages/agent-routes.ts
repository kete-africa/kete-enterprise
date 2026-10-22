import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { actorOf, bodyOf, GestureRefusal, runCommand } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { findAgent, jobInput, personOfAgent, setAgentJob } from '../agents/index.js';
import {
  acceptTakeOn,
  agentsOfHers,
  agentsScreen,
  agentThreadOf,
  answerRequest,
  RequestError,
  runRoutine,
} from './agent-threads.js';

// Her agents as colleagues, under /v1/threads (spec 099, FR-013 to FR-016): the list by state and
// their threads, their job description at work, a routine tried now, her answer to what they ask,
// and a holding handed to the agent that proposed to take it on.

type Ctx = Context<{ Variables: IdentityVariables }>;

const draftId = z.string().regex(/^[a-z]{3}_[0-9A-Za-z_-]{8,70}$/);
const proposalId = z.string().regex(/^prp_[0-9A-Za-z_-]{8,70}$/);

function refused(error: unknown): never {
  if (error instanceof RequestError) {
    const status = { not_found: 404, expired: 409, not_allowed: 403, settled: 409 } as const;
    throw new GestureRefusal(status[error.code], error.code, error.message);
  }
  throw error;
}

function hers(c: Ctx) {
  if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to decide.');
  return c.get('identity');
}

/** An agent that acts for her: she alone sets its job description and its routine. */
async function ownAgent(c: Ctx, agentId: string) {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) => {
    const agent = await findAgent(db, agentId);
    if (!agent) throw new GestureRefusal(404, 'not_found', 'No such agent here.');
    if ((await personOfAgent(db, agent)) !== identity.userId) {
      throw new GestureRefusal(403, 'forbidden', 'Only the person it acts for.');
    }
    return agent;
  });
}

export const agentThreadRoutes = new Hono<{ Variables: IdentityVariables }>()
  // Her agents by state, with their threads; how many work and how many wait for her (FR-013).
  .get('/agents', async (c: Ctx) => {
    const identity = c.get('identity');
    return c.json(await transaction(identity.organizationId, (db) => agentsScreen(db, identity)));
  })
  // The thread of an agent she may give work to: opened the first time.
  .post('/agents/:agentId/thread', async (c: Ctx) => {
    const identity = hers(c);
    const threadId = await transaction(identity.organizationId, async (db) => {
      const agent = (await agentsOfHers(db, identity)).find(
        (a) => a.agentId === c.req.param('agentId'),
      );
      if (!agent) throw new GestureRefusal(404, 'not_found', 'No such agent of hers.');
      return agentThreadOf(db, identity.organizationId, agent, identity.userId);
    });
    return c.json({ threadId });
  })
  // Its job description at work: take-on, covers, computer, return, routine (FR-016).
  .post('/agents/:agentId/job', async (c: Ctx) => {
    hers(c);
    const agent = await ownAgent(c, c.req.param('agentId') ?? '');
    const parsed = jobInput.safeParse({
      ...((await bodyOf(c)) as object | null),
      agentId: agent.agentId,
    });
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Its job description.');
    const key = c.req.header('idempotency-key') ?? crypto.randomUUID();
    const changed = await runCommand(
      c.get('identity').organizationId,
      actorOf(c),
      key,
      setAgentJob,
      parsed.data,
    );
    return c.json(changed);
  })
  // « Essayer maintenant »: its routine sets it to work at once.
  .post('/agents/:agentId/routine/now', async (c: Ctx) => {
    const identity = hers(c);
    const agent = await ownAgent(c, c.req.param('agentId') ?? '');
    if (!agent.routine) throw new GestureRefusal(409, 'no_routine', 'It has no routine.');
    const task = await transaction(identity.organizationId, (db) =>
      runRoutine(db, identity.organizationId, agent),
    );
    return c.json({ taskId: task?.taskId ?? null }, 201);
  })
  // Her answer to what an agent asks: once, always (a policy proposed), or not (FR-015).
  .post('/requests/:draftId/:how', async (c: Ctx) => {
    const identity = hers(c);
    const id = draftId.safeParse(c.req.param('draftId'));
    const how = z.enum(['once', 'always', 'refuse']).safeParse(c.req.param('how'));
    if (!id.success || !how.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Which request, and how she answers.');
    }
    return c.json(await answerRequest(identity, id.data, how.data).catch(refused));
  })
  // « Confier à l’agent »: the holding goes to the agent that proposed to take it on (FR-016).
  .post('/proposals/:proposalId/takeon', async (c: Ctx) => {
    const identity = hers(c);
    const id = proposalId.safeParse(c.req.param('proposalId'));
    if (!id.success) throw new GestureRefusal(422, 'invalid_input', 'Which proposal?');
    await transaction(identity.organizationId, (db) => acceptTakeOn(db, identity, id.data)).catch(
      refused,
    );
    return c.json({ handed: true }, 201);
  });
