import { SettingError } from '@kete/settings';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import {
  accountSettings,
  clearCenterSetting,
  setCenterSetting,
  settingsFor,
  viewsOf,
} from './settings.js';

// « Réglages » (spec 092): her preferences go to the Compte Kete, so they follow her in every app;
// the center's settings for the whole organization and each unit's stay here, journaled, set by an
// administrator.

type Ctx = Context<{ Variables: IdentityVariables }>;

const tokenOf = (c: Ctx) => /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? null;

const change = z.object({
  key: z.string().min(3).max(120),
  layer: z.enum(['person', 'app', 'entity']),
  unitId: z.string().min(1).max(100).optional(),
  value: z.unknown(),
});

function refused(error: unknown): never {
  if (error instanceof SettingError) {
    throw new GestureRefusal(422, error.code, error.message);
  }
  throw error;
}

function administrator(c: Ctx): void {
  if (!isAdministrator(c.get('identity'))) {
    throw new GestureRefusal(
      403,
      'forbidden',
      'Only administrators set the organization’s settings.',
    );
  }
}

export const settingsRoutes = new Hono<{ Variables: IdentityVariables }>()
  // Every setting with its value and where it comes from: hers, or at a unit for an administrator.
  .get('/', async (c: Ctx) => {
    const identity = c.get('identity');
    const unitId = c.req.query('unitId') ?? null;
    if (unitId) administrator(c);
    const resolved = await transaction(identity.organizationId, (db) =>
      settingsFor(db, { token: tokenOf(c), unitId }),
    );
    return c.json({
      settings: viewsOf(resolved),
      personal: accountSettings().connected && tokenOf(c) !== null,
      administrator: isAdministrator(identity),
    });
  })
  // Sets a value: hers in the Compte Kete, the center's or a unit's here.
  .post('/', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = change.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A setting and its value.');
    const { key, layer, unitId, value } = parsed.data;
    if (layer === 'person') {
      if (c.get('viewedBy'))
        throw new GestureRefusal(403, 'forbidden', 'Viewed as her: not yours.');
      const saved = await accountSettings().savePreference(tokenOf(c), key, value);
      if (!saved.ok) throw new GestureRefusal(422, saved.error, 'Not saved in the Compte Kete.');
      return c.json({ ok: true });
    }
    administrator(c);
    if (layer === 'entity' && !unitId) throw new GestureRefusal(422, 'invalid_input', 'A unit.');
    await transaction(identity.organizationId, (db) =>
      setCenterSetting(db, identity.organizationId, {
        layer,
        ...(unitId ? { unitId } : {}),
        key,
        value,
        by: identity.userId,
      }),
    ).catch(refused);
    return c.json({ ok: true });
  })
  // Takes a value back to what it inherits.
  .post('/clear', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = change.omit({ value: true }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A setting.');
    const { key, layer, unitId } = parsed.data;
    if (layer === 'person') {
      if (c.get('viewedBy'))
        throw new GestureRefusal(403, 'forbidden', 'Viewed as her: not yours.');
      const saved = await accountSettings().savePreference(tokenOf(c), key, null);
      if (!saved.ok) throw new GestureRefusal(422, saved.error, 'Not saved in the Compte Kete.');
      return c.json({ ok: true });
    }
    administrator(c);
    if (layer === 'entity' && !unitId) throw new GestureRefusal(422, 'invalid_input', 'A unit.');
    await transaction(identity.organizationId, (db) =>
      clearCenterSetting(db, identity.organizationId, {
        layer,
        ...(unitId ? { unitId } : {}),
        key,
        by: identity.userId,
      }),
    );
    return c.json({ ok: true });
  });
