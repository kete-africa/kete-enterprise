import type { CommandDefinition } from '@kete/commands';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator, reach } from '../rights/index.js';
import { decideRequest, DecisionRuleError, defineCircuit } from './commands.js';
import { currentStep, type DecisionRequest } from './decisions.record.js';
import { knownSubjects, mayDecide } from './engine.js';
import {
  findCircuit,
  findRequest,
  listActiveCircuits,
  pendingRequestIds,
  requestIdsOf,
} from './infrastructure/decisions.tables.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 005). */
export const decisionsPermissions = ['decisions:manage'] as const;

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Response> {
  try {
    return c.json(await runGesture(c, definition, input), 201);
  } catch (error) {
    if (error instanceof DecisionRuleError) {
      const status =
        error.code === 'not_found' ? 404 : error.code === 'not_an_approver' ? 403 : 409;
      throw new GestureRefusal(status, error.code, error.message);
    }
    throw error;
  }
}

/** A request as the Inbox shows it: its current step, and whether it waits too long. */
function forInbox(request: DecisionRequest, remindAfterHours: number) {
  const step = currentStep(request);
  const since = step?.enteredAt ? new Date(step.enteredAt).getTime() : null;
  return {
    ...request,
    currentStep: step?.position ?? null,
    overdue: since !== null && Date.now() - since > remindAfterHours * 3_600_000,
  };
}

/** The decisions' routes, under /v1/decisions (spec 005). */
export const decisionsRoutes = new Hono<{ Variables: IdentityVariables }>()
  // What waits for this person's decision, and her own requests.
  .get('/inbox', async (c) => {
    const identity = c.get('identity');
    const inbox = await transaction(identity.organizationId, async (db) => {
      const reminders = new Map<string, number>();
      const remindAfter = async (circuitId: string) => {
        if (!reminders.has(circuitId)) {
          reminders.set(circuitId, (await findCircuit(db, circuitId))?.remindAfterHours ?? 48);
        }
        return reminders.get(circuitId) ?? 48;
      };
      const toDecide = [];
      for (const id of await pendingRequestIds(db)) {
        const request = await findRequest(db, id);
        if (request && (await mayDecide(db, request, identity.userId, isAdministrator(identity)))) {
          toDecide.push(forInbox(request, await remindAfter(request.circuitId)));
        }
      }
      const mine = [];
      for (const id of await requestIdsOf(db, identity.userId)) {
        const request = await findRequest(db, id);
        if (request) mine.push(forInbox(request, await remindAfter(request.circuitId)));
      }
      return { toDecide, mine };
    });
    return c.json(inbox);
  })
  .post('/requests/:requestId/decide', async (c) => {
    const body = (await bodyOf(c)) as Record<string, unknown>;
    return run(c, decideRequest, {
      ...body,
      requestId: c.req.param('requestId'),
      administrator: isAdministrator(c.get('identity')),
    });
  })
  // Circuits are the organization's rules: « decisions:manage » everywhere.
  .get('/circuits', async (c) => {
    const identity = c.get('identity');
    const circuits = await transaction(identity.organizationId, async (db) => {
      if (!(await reach(db, identity, 'decisions:manage')).everywhere) return null;
      return listActiveCircuits(db);
    });
    if (!circuits) throw new GestureRefusal(403, 'forbidden', 'This needs « decisions:manage ».');
    return c.json({ subjects: knownSubjects(), circuits });
  })
  .post('/circuits', async (c) => {
    const identity = c.get('identity');
    const allowed = await transaction(
      identity.organizationId,
      async (db) => (await reach(db, identity, 'decisions:manage')).everywhere,
    );
    if (!allowed) throw new GestureRefusal(403, 'forbidden', 'This needs « decisions:manage ».');
    return run(c, defineCircuit, await bodyOf(c));
  });
