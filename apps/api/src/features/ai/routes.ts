import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { secretsOn } from '../../platform/secrets.js';
import { isAdministrator } from '../rights/index.js';
import {
  connectionInput,
  readConnection,
  readPolicy,
  removeConnection,
  saveConnection,
  setPolicy,
} from './connections.js';
import { checkKey } from './infrastructure/key-check.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** Her own key is hers to set: never while an administrator views her space (spec 010). */
function herself(c: Ctx): void {
  if (c.get('viewedBy')) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only the person sets her own key.');
  }
}

/** Each person's AI connection and the organization's policy, under /v1/ai (spec 026). */
export const aiRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/connection', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        policy: await readPolicy(db),
        available: secretsOn(),
        connection: await readConnection(db, userId),
      })),
    );
  })
  .post('/connection', async (c) => {
    herself(c);
    if (!secretsOn()) {
      throw new GestureRefusal(409, 'secrets_off', 'This instance keeps no secret yet.');
    }
    const parsed = connectionInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'A provider, a model, a key.');
    const { organizationId, userId } = c.get('identity');
    if ((await transaction(organizationId, readPolicy)) === 'off') {
      throw new GestureRefusal(409, 'personal_off', 'The organization pays for every model.');
    }
    // The key is tried once, on its provider: a wrong key is refused before it is kept.
    const check = await checkKey(parsed.data.provider, parsed.data.apiKey);
    if (check === 'invalid')
      throw new GestureRefusal(422, 'invalid_key', 'The provider refuses this key.');
    if (check === 'unreachable') {
      throw new GestureRefusal(409, 'provider_unreachable', 'The provider does not answer.');
    }
    const connection = await transaction(organizationId, async (db) => {
      await saveConnection(db, organizationId, userId, parsed.data);
      return readConnection(db, userId);
    });
    return c.json({ connection }, 201);
  })
  .post('/connection/remove', async (c) => {
    herself(c);
    const { organizationId, userId } = c.get('identity');
    await transaction(organizationId, (db) => removeConnection(db, userId));
    return c.json({ connection: null });
  })
  // Who pays for the models is the frame: the organization's administrators decide.
  .post('/policy', async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) {
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    }
    const parsed = z
      .object({ personal: z.enum(['off', 'allowed', 'required']) })
      .safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'off, allowed or required.');
    await transaction(identity.organizationId, (db) =>
      setPolicy(db, identity.organizationId, parsed.data.personal),
    );
    return c.json({ policy: parsed.data.personal }, 201);
  });
