import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { appGrants } from './app-permissions.js';
import { appDecision, AppDecisionError, appDecisionInput, openAppDecision } from './decisions.js';

const product = /^prd_[a-z0-9_]{2,40}$/;

/**
 * What the team's apps ask Kete Enterprise, with the person's token (spec 022): her grants for one
 * app. An unknown app is simply not managed here.
 */
export const appRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/:product/grants', async (c) => {
    const name = c.req.param('product');
    if (!product.test(name)) return c.json({ error: 'not_found' }, 404);
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, (db) => appGrants(db, identity, name)),
    );
  })
  // An app asks a decision for the person (spec 023): the circuits find who decides.
  .post('/:product/decisions', async (c) => {
    const name = c.req.param('product');
    if (!product.test(name)) throw new GestureRefusal(404, 'not_found', 'No such app.');
    const parsed = appDecisionInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', parsed.error.message);
    const identity = c.get('identity');
    try {
      const opened = await transaction(identity.organizationId, (db) =>
        openAppDecision(db, identity.organizationId, identity, name, parsed.data),
      );
      return c.json(opened, 201);
    } catch (error) {
      if (error instanceof AppDecisionError) {
        throw new GestureRefusal(error.code === 'duplicate' ? 409 : 422, error.code, error.message);
      }
      throw error;
    }
  })
  // The person who asked reads where her request stands.
  .get('/:product/decisions/:requestId', async (c) => {
    const identity = c.get('identity');
    const decision = await transaction(identity.organizationId, async (db) => {
      const found = await appDecision(db, c.req.param('product'), c.req.param('requestId'));
      const { rows } = await db.query<{ requester_user_id: string }>(
        `select requester_user_id from decision_requests where request_id = $1`,
        [c.req.param('requestId')],
      );
      return found && rows[0]?.requester_user_id === identity.userId ? found : null;
    });
    if (!decision) throw new GestureRefusal(404, 'not_found', 'No such request.');
    return c.json(decision);
  });
