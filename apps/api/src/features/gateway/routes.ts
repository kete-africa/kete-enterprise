import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { callsOf } from './infrastructure/gateway.tables.js';

/** The gateway's routes under /v1/gateway: a person reads her own trace (spec 006). */
export const gatewayRoutes = new Hono<{ Variables: IdentityVariables }>().get(
  '/calls',
  async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({ calls: await transaction(organizationId, (db) => callsOf(db, userId)) });
  },
);
