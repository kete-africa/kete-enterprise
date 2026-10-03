import { Hono, type Context } from 'hono';
import { transaction } from '../../platform/db.js';
import { GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { colleagueCard, myCard, unitCard } from './directory.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
const day = /^\d{4}-\d{2}-\d{2}$/;

function asOf(c: Ctx): string | undefined {
  const value = c.req.query('asOf');
  if (value === undefined) return undefined;
  if (!day.test(value))
    throw new GestureRefusal(422, 'invalid_date', 'asOf is written YYYY-MM-DD.');
  return value;
}

const unknown = () => new GestureRefusal(404, 'not_found', 'Nobody, or nothing, you may see.');

/**
 * The directory, under /v1/directory (spec 023): what the team's apps read of the organization,
 * with the person's token. Whatever she may not see answers as unknown.
 */
export const directoryRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/me', async (c) => {
    const identity = c.get('identity');
    const card = await transaction(identity.organizationId, (db) => myCard(db, identity, asOf(c)));
    if (!card) throw unknown();
    return c.json(card);
  })
  .get('/people/:userId', async (c) => {
    const identity = c.get('identity');
    const card = await transaction(identity.organizationId, (db) =>
      colleagueCard(db, identity, c.req.param('userId'), asOf(c)),
    );
    if (!card) throw unknown();
    return c.json(card);
  })
  .get('/units/:unitId', async (c) => {
    const identity = c.get('identity');
    const unit = await transaction(identity.organizationId, (db) =>
      unitCard(db, identity, c.req.param('unitId'), asOf(c)),
    );
    if (!unit) throw unknown();
    return c.json(unit);
  });
