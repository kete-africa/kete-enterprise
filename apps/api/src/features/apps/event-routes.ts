import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import { appOf } from '../../platform/identity.js';
import { appDecision, productOfClient } from './decisions.js';
import { receiveAppEvent, type EventOutcome } from './events.js';

const organization = /^org_[\w-]{2,64}$/;

/**
 * What the apps say as themselves, under /public/apps, with their own token — never a person's:
 * their events (spec 025), an outcome per event as `delivery-result.v1` says; the outcome of the
 * decisions they asked (spec 023).
 */
export const appEventRoutes = new Hono()
  .post('/events', async (c) => {
    const app = await appOf(c.req.raw);
    if (!app) return c.json({ error: 'unauthenticated' }, 401);
    const body = (await c.req.json().catch(() => null)) as { events?: unknown } | null;
    if (!Array.isArray(body?.events) || body.events.length > 100) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const results: EventOutcome[] = [];
    for (const event of body.events) {
      const org = (event as { organization?: unknown } | null)?.organization;
      const id = (event as { id?: unknown } | null)?.id;
      if (typeof org !== 'string' || !organization.test(org)) {
        results.push({
          id: typeof id === 'string' ? id : '',
          outcome: 'refused',
          reason: 'invalid',
        });
        continue;
      }
      results.push(await transaction(org, (db) => receiveAppEvent(db, app.clientId, event)));
    }
    return c.json({ results });
  })
  // The outcome of a decision the app asked, read with its own token (spec 023).
  .get('/:organizationId/decisions/:requestId', async (c) => {
    const app = await appOf(c.req.raw);
    if (!app) return c.json({ error: 'unauthenticated' }, 401);
    const org = c.req.param('organizationId');
    if (!organization.test(org)) return c.json({ error: 'not_found' }, 404);
    const decision = await transaction(org, async (db) => {
      const product = await productOfClient(db, app.clientId);
      return product ? appDecision(db, product, c.req.param('requestId')) : null;
    });
    return decision ? c.json(decision) : c.json({ error: 'not_found' }, 404);
  });
