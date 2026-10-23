import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator, reach } from '../rights/index.js';
import {
  createAsset,
  createPlace,
  findAsset,
  findPlace,
  ObjectRefusal,
  updateAsset,
  updatePlace,
} from './assets.js';
import { kindsOf } from './kinds.js';
import { axesOf, findObjects, nameOfPerson, objectCard, titlesOf } from './objects.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 100). */
export const objectsPermissions = ['objects:read', 'objects:manage'] as const;

async function manages(c: Ctx, db: SqlExecutor): Promise<boolean> {
  const r = await reach(db, c.get('identity'), 'objects:manage');
  return isAdministrator(c.get('identity')) || r.everywhere || r.units.size > 0;
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof ObjectRefusal) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 422, error.code, error.message);
    }
    throw error;
  }
}

const text = (v: string | undefined) => (v && v.trim() ? v.trim().slice(0, 200) : undefined);

/** The index, under /v1/objects (spec 100): what she may read, found, and one with its links. */
export const objectsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    const identity = c.get('identity');
    const q = (k: string) => text(c.req.query(k));
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const objects = await findObjects(db, identity, {
          q: q('q'),
          kind: q('kind'),
          projectId: q('project'),
          partyId: q('party'),
          unitId: q('unit'),
          personId: q('person'),
          state: q('state'),
          closed: c.req.query('closed') === 'true',
          limit: Number.isFinite(limit) ? limit : 50,
        });
        // What they belong to, named: an object she may read names its client, project, unit.
        return { objects, titles: await titlesOf(db, axesOf(objects)) };
      }),
    );
  })
  // Every kind of the organization: the center's references and the apps' kinds.
  .get('/kinds', async (c: Ctx) => {
    const { organizationId } = c.get('identity');
    return c.json({ kinds: await transaction(organizationId, (db) => kindsOf(db)) });
  })
  .get('/:kind/:id', async (c: Ctx) => {
    const identity = c.get('identity');
    const card = await transaction(identity.organizationId, (db) =>
      objectCard(db, identity, c.req.param('kind') ?? '', c.req.param('id') ?? ''),
    );
    // Unknown and not hers answer alike: an object's existence is not said to who may not read it.
    if (!card) throw new GestureRefusal(404, 'not_found', 'No such object of hers.');
    return c.json(card);
  });

/** One asset or place she may read, with its own fields; its card comes from the index. */
async function readable<T>(
  c: Ctx,
  kind: 'asset' | 'place',
  id: string,
  find: (db: SqlExecutor, id: string) => Promise<T | null>,
) {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) => {
    const card = await objectCard(db, identity, kind, id);
    const found = card ? await find(db, id) : null;
    if (!card || !found) throw new GestureRefusal(404, 'not_found', `No such ${kind} of hers.`);
    return { card, found, manages: await manages(c, db) };
  });
}

/** Assets, under /v1/assets (spec 100): what the organization installs or owns and keeps. */
export const assetsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/:assetId', async (c: Ctx) => {
    const {
      card,
      found,
      manages: may,
    } = await readable(c, 'asset', c.req.param('assetId') ?? '', findAsset);
    const identity = c.get('identity');
    const mine = found.holderUserId === identity.userId;
    const named = await transaction(identity.organizationId, async (db) => ({
      titles: await titlesOf(db, [
        { kind: 'party', id: found.partyId },
        { kind: 'project', id: found.projectId },
        { kind: 'unit', id: found.unitId },
        { kind: 'place', id: found.placeId },
      ]),
      holder: await nameOfPerson(db, found.holderUserId),
    }));
    return c.json({ asset: found, ...card, ...named, changeable: may || mine });
  })
  .post('/', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!(await transaction(identity.organizationId, (db) => manages(c, db)))) {
      throw new GestureRefusal(403, 'forbidden', 'Assets are not hers to declare.');
    }
    const body = (await bodyOf(c)) as object | null;
    return c.json(
      await run(c, createAsset, { ...body, creator: { userId: identity.userId } }),
      201,
    );
  })
  // Who manages the objects, or who answers for this one, changes it — its state first of all.
  .post('/:assetId', async (c: Ctx) => {
    const { found, manages: may } = await readable(
      c,
      'asset',
      c.req.param('assetId') ?? '',
      findAsset,
    );
    if (!may && found.holderUserId !== c.get('identity').userId) {
      throw new GestureRefusal(403, 'forbidden', 'Who manages the objects, or who answers for it.');
    }
    const body = (await bodyOf(c)) as object | null;
    return c.json(await run(c, updateAsset, { ...body, assetId: found.assetId }));
  });

/** Places, under /v1/places (spec 100): where things are. */
export const placesRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/:placeId', async (c: Ctx) => {
    const {
      card,
      found,
      manages: may,
    } = await readable(c, 'place', c.req.param('placeId') ?? '', findPlace);
    const identity = c.get('identity');
    const titles = await transaction(identity.organizationId, (db) =>
      titlesOf(db, [
        { kind: 'party', id: found.partyId },
        { kind: 'unit', id: found.unitId },
      ]),
    );
    return c.json({ place: found, ...card, titles, changeable: may });
  })
  .post('/', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!(await transaction(identity.organizationId, (db) => manages(c, db)))) {
      throw new GestureRefusal(403, 'forbidden', 'Places are not hers to declare.');
    }
    const body = (await bodyOf(c)) as object | null;
    return c.json(
      await run(c, createPlace, { ...body, creator: { userId: identity.userId } }),
      201,
    );
  })
  .post('/:placeId', async (c: Ctx) => {
    const { found, manages: may } = await readable(
      c,
      'place',
      c.req.param('placeId') ?? '',
      findPlace,
    );
    if (!may) throw new GestureRefusal(403, 'forbidden', 'Who manages the objects.');
    const body = (await bodyOf(c)) as object | null;
    return c.json(await run(c, updatePlace, { ...body, placeId: found.placeId }));
  });
