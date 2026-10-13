import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { appsFor } from './listing.js';

/** « Apps », at GET /v1/apps (spec 070): what stands behind the center for the person. */
export function appsListingRoutes(permissions: readonly string[]) {
  return new Hono<{ Variables: IdentityVariables }>().get('/', async (c) => {
    const identity = c.get('identity');
    return c.json({
      apps: await transaction(identity.organizationId, (db) => appsFor(db, identity, permissions)),
    });
  });
}
