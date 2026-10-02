import { defineCommand } from '@kete/commands';
import { Hono, type MiddlewareHandler } from 'hono';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import { readModules, readSettings, writeModule } from './infrastructure/organization.tables.js';
import { setModuleInput, type ModuleKey } from './organization.record.js';

export const setModule = defineCommand({
  name: 'set-module',
  input: setModuleInput,
  reversibility: { reversible: true, inverse: 'set-module' },
  async handler(input, { db, organizationId }) {
    await writeModule(db, organizationId, input.module, input.enabled);
    return input;
  },
  summarize: (input) => `Module ${input.module} ${input.enabled ? 'on' : 'off'}`,
});

/**
 * A business feature's routes answer only when its module is on for the caller's organization:
 * switched off, the tool disappears and its data stays.
 */
export function requireModule(
  module: ModuleKey,
): MiddlewareHandler<{ Variables: IdentityVariables }> {
  return async (c, next) => {
    const { organizationId } = c.get('identity');
    const modules = await transaction(organizationId, (db) => readModules(db));
    if (!modules[module]) {
      throw new GestureRefusal(403, 'module_disabled', `The module « ${module} » is off here.`);
    }
    await next();
  };
}

/** The organization's modules and settings, under /v1/organization (spec 010). */
export const organizationRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        modules: await readModules(db),
        settings: await readSettings(db),
      })),
    );
  })
  // Which tools the organization uses is the frame: its administrators decide.
  .post('/modules', async (c) => {
    if (!isAdministrator(c.get('identity'))) {
      throw new GestureRefusal(403, 'forbidden', 'Only administrators switch modules.');
    }
    return c.json(await runGesture(c, setModule, await bodyOf(c)), 201);
  });
