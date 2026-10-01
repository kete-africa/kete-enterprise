import { healthHandler, manifestHandler } from '@kete/sdk';
import { Hono } from 'hono';
import { agentsPermissions, agentsRoutes } from './features/agents/index.js';
import { compliancePermissions, complianceRoutes } from './features/compliance/index.js';
import { decisionsPermissions, decisionsRoutes } from './features/decisions/index.js';
import { gatewayResourceMetadata, gatewayRoutes, handleGateway } from './features/gateway/index.js';
import { registryPermissions, registryRoutes } from './features/registry/index.js';
import { rightsPermissions, rightsRoutes } from './features/rights/index.js';
import { structurePermissions, structureRoutes } from './features/structure/index.js';
import { GestureRefusal } from './platform/gestures.js';
import { requirePerson, type IdentityVariables } from './platform/identity.js';
import { health, manifest } from './platform/service.js';

/** Every permission a role may allow: each feature declares its own (spec 003). */
export const permissionCatalog = [
  ...structurePermissions,
  ...rightsPermissions,
  ...registryPermissions,
  ...decisionsPermissions,
  ...agentsPermissions,
  ...compliancePermissions,
];

/**
 * The API (doctrine D-029): framework-free building blocks from kete-core (`Request → Response`),
 * served by Hono. Each feature adds its routes under /v1, behind a person's token.
 */
export function createApi(): Hono {
  const api = new Hono();
  api.get('/health', () => healthHandler(health)());
  api.get('/.well-known/kete', () => manifestHandler(manifest())());
  // The MCP gateway checks its own token, and tells copilots where to get one (spec 006).
  api.all('/mcp', (c) => handleGateway(c.req.raw));
  api.get('/.well-known/oauth-protected-resource', (c) => gatewayResourceMetadata(c.req.raw));

  const v1 = new Hono<{ Variables: IdentityVariables }>();
  v1.use('*', requirePerson);
  // Who is calling, and in which organization: the first thing the screens ask.
  v1.get('/me', (c) => {
    const { userId, name, email, organizationId, role } = c.get('identity');
    return c.json({ userId, name, email, organizationId, role });
  });
  v1.route('/structure', structureRoutes);
  v1.route('/rights', rightsRoutes(permissionCatalog));
  v1.route('/registry', registryRoutes);
  v1.route('/decisions', decisionsRoutes);
  v1.route('/gateway', gatewayRoutes);
  v1.route('/agents', agentsRoutes(permissionCatalog));
  v1.route('/compliance', complianceRoutes);
  api.route('/v1', v1);
  // A refused gesture says why, with a stable code the screens translate.
  api.onError((error, c) => {
    if (error instanceof GestureRefusal) {
      return c.json({ error: error.code, message: error.message }, error.status);
    }
    console.error(error);
    return c.json({ error: 'internal' }, 500);
  });
  return api;
}
