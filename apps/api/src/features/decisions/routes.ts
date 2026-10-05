import type { KeteIdentity } from '@kete/auth';
import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator, reach } from '../rights/index.js';
import { decideRequest, DecisionRuleError, defineCircuit } from './commands.js';
import { currentStep, type DecisionRequest } from './decisions.record.js';
import { announceDecided, mayDecide, subjectsOf } from './engine.js';
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
function forInbox(
  request: DecisionRequest,
  remindAfterHours: number,
  labels: Map<string, { fr: string; en: string }>,
) {
  const step = currentStep(request);
  const since = step?.enteredAt ? new Date(step.enteredAt).getTime() : null;
  return {
    ...request,
    // An app's subject comes with its words, from its card (spec 023).
    subjectLabel: labels.get(request.subject) ?? null,
    currentStep: step?.position ?? null,
    overdue: since !== null && Date.now() - since > remindAfterHours * 3_600_000,
  };
}

/** The decisions' routes, under /v1/decisions (spec 005). */
export const decisionsRoutes = new Hono<{ Variables: IdentityVariables }>()
  // What waits for this person's decision, and her own requests.
  .get('/inbox', async (c) => {
    const identity = c.get('identity');
    return c.json(await transaction(identity.organizationId, (db) => inboxFor(db, identity)));
  })
  .post('/requests/:requestId/decide', async (c) => {
    const body = (await bodyOf(c)) as Record<string, unknown>;
    const requestId = c.req.param('requestId');
    const response = await run(c, decideRequest, {
      ...body,
      requestId,
      administrator: isAdministrator(c.get('identity')),
    });
    // Once decided, whoever listens is told — an app that asked (spec 023) — after the commit.
    const answer = (await response.clone().json()) as { status?: string };
    if (answer.status === 'approved' || answer.status === 'refused') {
      await announceDecided(c.get('identity').organizationId, requestId);
    }
    return response;
  })
  // Circuits are the organization's rules: « decisions:manage » everywhere.
  .get('/circuits', async (c) => {
    const identity = c.get('identity');
    const found = await transaction(identity.organizationId, async (db) => {
      if (!(await reach(db, identity, 'decisions:manage')).everywhere) return null;
      return { circuits: await listActiveCircuits(db), subjects: await subjectsOf(db) };
    });
    if (!found) throw new GestureRefusal(403, 'forbidden', 'This needs « decisions:manage ».');
    // The apps' subjects come with their words, from their cards (spec 023).
    const labels = Object.fromEntries(
      found.subjects.flatMap((s) => (s.label ? [[s.subject, s.label]] : [])),
    );
    return c.json({
      subjects: found.subjects.map((s) => s.subject),
      labels,
      circuits: found.circuits,
    });
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

/**
 * What waits for the person's decision, and her own requests, with their current step and whether
 * it waits too long. The screens and the MCP gateway read the same.
 */
export async function inboxFor(db: SqlExecutor, identity: Pick<KeteIdentity, 'role' | 'userId'>) {
  const reminders = new Map<string, number>();
  const remindAfter = async (circuitId: string) => {
    if (!reminders.has(circuitId)) {
      reminders.set(circuitId, (await findCircuit(db, circuitId))?.remindAfterHours ?? 48);
    }
    return reminders.get(circuitId) ?? 48;
  };
  const labels = new Map(
    (await subjectsOf(db)).flatMap((s) => (s.label ? [[s.subject, s.label] as const] : [])),
  );
  const toDecide = [];
  for (const id of await pendingRequestIds(db)) {
    const request = await findRequest(db, id);
    if (request && (await mayDecide(db, request, identity.userId, isAdministrator(identity)))) {
      toDecide.push(forInbox(request, await remindAfter(request.circuitId), labels));
    }
  }
  const mine = [];
  for (const id of await requestIdsOf(db, identity.userId)) {
    const request = await findRequest(db, id);
    if (request) mine.push(forInbox(request, await remindAfter(request.circuitId), labels));
  }
  return { toDecide, mine };
}

/**
 * One request as a reader sees it (spec 047): whoever asked it, whoever may decide its current
 * step, whoever decided one of its steps, an administrator — null for anyone else.
 */
export async function requestFor(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'role' | 'userId'>,
  requestId: string,
): Promise<{ request: ReturnType<typeof forInbox>; mayDecide: boolean } | null> {
  const request = await findRequest(db, requestId);
  if (!request) return null;
  const administrator = isAdministrator(identity);
  const decides =
    request.status === 'pending' &&
    (await mayDecide(db, request, identity.userId, isAdministrator(identity)));
  const involved =
    administrator ||
    decides ||
    request.requesterUserId === identity.userId ||
    request.steps.some((s) => s.decidedBy === identity.userId);
  if (!involved) return null;
  const circuit = await findCircuit(db, request.circuitId);
  const labels = new Map(
    (await subjectsOf(db)).flatMap((s) => (s.label ? [[s.subject, s.label] as const] : [])),
  );
  return {
    request: forInbox(request, circuit?.remindAfterHours ?? 48, labels),
    mayDecide: decides,
  };
}
