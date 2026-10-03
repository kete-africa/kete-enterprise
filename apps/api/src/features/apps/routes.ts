import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { appGrants } from './app-permissions.js';

const product = /^prd_[a-z0-9_]{2,40}$/;

/**
 * What the team's apps ask Kete Enterprise, with the person's token (spec 022): her grants for one
 * app. An unknown app is simply not managed here.
 */
export const appRoutes = new Hono<{ Variables: IdentityVariables }>().get(
  '/:product/grants',
  async (c) => {
    const name = c.req.param('product');
    if (!product.test(name)) return c.json({ error: 'not_found' }, 404);
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, (db) => appGrants(db, identity, name)),
    );
  },
);
