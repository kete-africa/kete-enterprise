import { Hono } from 'hono';
import { transaction } from '../../platform/db.js';
import { appOf } from '../../platform/identity.js';
import { appDecision, productOfClient } from './decisions.js';
import { receiveAppEvent, type EventOutcome } from './events.js';
import { ObjectsError, receiveAppObjects } from '../objects/index.js';
import { AppModelError, receiveAppHoldings } from './model.js';

const organization = /^org_[\w-]{2,64}$/;
const productId = /^prd_[a-z0-9_]{2,40}$/;

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
  // Every thing the app holds now, with its own token (spec 091): kept, relayed, finished.
  .put('/holdings', async (c) => {
    const app = await appOf(c.req.raw);
    if (!app) return c.json({ error: 'unauthenticated' }, 401);
    const body = (await c.req.json().catch(() => null)) as {
      organization?: unknown;
      product?: unknown;
      holdings?: unknown;
    } | null;
    const org = body?.organization;
    const product = body?.product;
    if (
      typeof org !== 'string' ||
      !organization.test(org) ||
      typeof product !== 'string' ||
      !productId.test(product) ||
      !Array.isArray(body?.holdings)
    ) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const holdings = body.holdings as unknown[];
    try {
      return c.json(
        await transaction(org, (db) =>
          receiveAppHoldings(db, org, app.clientId, { product, holdings }),
        ),
      );
    } catch (error) {
      if (error instanceof AppModelError) {
        return c.json(
          { error: error.code, issues: error.issues },
          error.code === 'unknown_app' ? 404 : 422,
        );
      }
      throw error;
    }
  })
  // Its objects, with its own token (spec 100, kete-core spec 142): the center's index follows them.
  .put('/objects', async (c) => {
    const app = await appOf(c.req.raw);
    if (!app) return c.json({ error: 'unauthenticated' }, 401);
    const body = (await c.req.json().catch(() => null)) as {
      organization?: unknown;
      product?: unknown;
      objects?: unknown;
    } | null;
    const org = body?.organization;
    const product = body?.product;
    if (
      typeof org !== 'string' ||
      !organization.test(org) ||
      typeof product !== 'string' ||
      !productId.test(product) ||
      !Array.isArray(body?.objects)
    ) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const objects = body.objects as unknown[];
    try {
      return c.json(
        await transaction(org, (db) =>
          receiveAppObjects(db, org, app.clientId, { product, objects }),
        ),
      );
    } catch (error) {
      if (error instanceof ObjectsError) {
        return c.json(
          { error: error.code, issues: error.issues },
          error.code === 'unknown_app' ? 404 : 422,
        );
      }
      throw error;
    }
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
