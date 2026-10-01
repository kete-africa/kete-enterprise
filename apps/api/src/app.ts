import { healthHandler, manifestHandler } from '@kete/sdk';
import { Hono } from 'hono';
import { structureRoutes } from './features/structure/index.js';
import { GestureRefusal } from './platform/gestures.js';
import { requirePerson, type IdentityVariables } from './platform/identity.js';
import { health, manifest } from './platform/service.js';

/**
 * The API (doctrine D-029): framework-free building blocks from kete-core (`Request → Response`),
 * served by Hono. Each feature adds its routes under /v1, behind a person's token.
 */
export function createApi(): Hono {
  const api = new Hono();
  api.get('/health', () => healthHandler(health)());
  api.get('/.well-known/kete', () => manifestHandler(manifest())());

  const v1 = new Hono<{ Variables: IdentityVariables }>();
  v1.use('*', requirePerson);
  // Who is calling, and in which organization: the first thing the screens ask.
  v1.get('/me', (c) => {
    const { userId, name, email, organizationId, role } = c.get('identity');
    return c.json({ userId, name, email, organizationId, role });
  });
  v1.route('/structure', structureRoutes);
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
