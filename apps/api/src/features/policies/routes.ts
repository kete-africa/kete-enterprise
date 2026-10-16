import { currentPolicies, policyVersions, readDecisions } from '@kete/policies';
import { validateGesture, type Gesture } from '@kete/sdk';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator, listRoles } from '../rights/index.js';
import { PolicyRuleError, savePolicyCommand, setPolicyStatus } from './commands.js';
import {
  approversFor,
  decideFor,
  engine,
  GestureError,
  personBehind,
  policyCounts,
} from './policies.js';
import { NoModelError, proposePolicy } from './propose.js';
import { basePolicies, centerSchema, knownGestures } from './schema.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

function administrator(c: Ctx): void {
  if (!isAdministrator(c.get('identity'))) {
    throw new GestureRefusal(403, 'forbidden', 'Only administrators write the policies.');
  }
}

function refuse(error: unknown): never {
  if (error instanceof PolicyRuleError) {
    const status = { not_found: 404, reserved: 409, not_observed: 409, invalid_rule: 422 } as const;
    throw new GestureRefusal(status[error.code], error.code, error.message);
  }
  throw error;
}

const none = { allowed: 0, asked: 0, refused: 0, trial: 0 };

/**
 * The center's policies, under /v1/policies (spec 088): administrators read and write them, a
 * person — or an app or an agent on her behalf — asks at the gesture.
 */
export const policiesRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    administrator(c);
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => {
        const counts = await policyCounts(db);
        return {
          policies: [
            ...basePolicies.map((p) => ({ ...p, kete: true })),
            ...(await currentPolicies(db)).map((p) => ({ ...p, kete: false })),
          ].map((p) => ({ ...p, lastMonth: counts.get(p.id) ?? none })),
          gestures: knownGestures,
          schema: centerSchema,
        };
      }),
    );
  })
  // The journal of decisions, the latest first; by policy when one is named.
  .get('/journal', async (c: Ctx) => {
    administrator(c);
    const { organizationId } = c.get('identity');
    const policyId = c.req.query('policyId');
    const decisions = await transaction(organizationId, (db) =>
      readDecisions(db, { ...(policyId ? { policyId } : {}), limit: 100 }),
    );
    return c.json({ decisions });
  })
  // The model proposes the rule of a sentence; nothing is kept.
  .post('/propose', async (c: Ctx) => {
    administrator(c);
    const identity = c.get('identity');
    const parsed = z
      .object({ sentence: z.string().trim().min(3).max(500) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A sentence.');
    const roles = await transaction(identity.organizationId, (db) => listRoles(db));
    try {
      const proposal = await proposePolicy(
        identity,
        parsed.data.sentence,
        roles.map((r) => ({ roleId: r.roleId, name: r.name })),
      );
      return c.json({ proposal });
    } catch (error) {
      if (error instanceof NoModelError) {
        throw new GestureRefusal(409, 'assistant_unavailable', 'No model configured.');
      }
      throw error;
    }
  })
  // Whether a rule fits the center's schema, and why not.
  .post('/check', async (c: Ctx) => {
    administrator(c);
    const parsed = z.object({ rule: z.string().min(1).max(4000) }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A rule.');
    return c.json(engine.check(parsed.data.rule));
  })
  .post('/', async (c: Ctx) => {
    administrator(c);
    try {
      return c.json({ policy: await runGesture(c, savePolicyCommand, await bodyOf(c)) }, 201);
    } catch (error) {
      if (error instanceof PolicyRuleError && error.code === 'invalid_rule') {
        return c.json({ error: 'invalid_rule', message: error.message, issues: error.issues }, 422);
      }
      return refuse(error);
    }
  })
  // A person, an app on her behalf, or her agent asks at the gesture (FR-006).
  .post('/decide', async (c: Ctx) => {
    const identity = c.get('identity');
    const body = (await bodyOf(c)) as { gesture?: Partial<Gesture> } | null;
    const gesture = { at: new Date().toISOString(), ...body?.gesture } as Gesture;
    const checked = validateGesture(gesture);
    if (!checked.ok) {
      throw new GestureRefusal(422, 'invalid_gesture', checked.errors.join('; '));
    }
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        try {
          if ((await personBehind(db, gesture.actor)) !== identity.userId) {
            throw new GestureRefusal(403, 'not_yours', 'She asks for herself or her agents.');
          }
          const decision = await decideFor(db, identity.organizationId, gesture);
          return {
            decision: {
              ...decision,
              approvers: await approversFor(db, gesture, decision.approvers ?? []),
            },
          };
        } catch (error) {
          if (error instanceof GestureError) {
            throw new GestureRefusal(422, error.code, error.message);
          }
          throw error;
        }
      }),
    );
  })
  .get('/:policyId', async (c: Ctx) => {
    administrator(c);
    const { organizationId } = c.get('identity');
    const policyId = c.req.param('policyId') ?? '';
    const found = await transaction(organizationId, async (db) => ({
      versions: await policyVersions(db, policyId),
      decisions: await readDecisions(db, { policyId, limit: 50 }),
    }));
    if (found.versions.length === 0) {
      throw new GestureRefusal(404, 'not_found', 'No such policy here.');
    }
    return c.json(found);
  })
  .post('/:policyId/status', async (c: Ctx) => {
    administrator(c);
    const body = (await bodyOf(c)) as object | null;
    const changed = await runGesture(c, setPolicyStatus, {
      ...body,
      policyId: c.req.param('policyId'),
    }).catch(refuse);
    return c.json(changed);
  });
