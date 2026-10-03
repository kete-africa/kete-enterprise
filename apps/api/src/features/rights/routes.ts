import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import {
  createRole,
  grantRole,
  revokeGrant,
  RightsRuleError,
  setRolePermissionsCommand,
} from './commands.js';
import { findGrant, listGrants, listRoles } from './infrastructure/rights.tables.js';
import { covers, reach } from './rights.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
const today = () => new Date().toISOString().slice(0, 10);

/** The permissions the organization's apps declare, by app (spec 022). */
export type AppCatalog = (db: SqlExecutor) => Promise<{ permissions: { key: string }[] }[]>;

/**
 * The rights' routes, under /v1/rights (spec 003). `permissions` is the catalog the features
 * declare, `apps` what the organization's apps declare in their cards (spec 022): a role allows
 * only permissions that exist.
 */
export function rightsRoutes(permissions: readonly string[], apps: AppCatalog = async () => []) {
  const known = new Set(permissions);
  const appKeys = async (db: SqlExecutor) =>
    (await apps(db)).flatMap((a) => a.permissions.map((p) => p.key));

  async function manageReach(c: Ctx) {
    const identity = c.get('identity');
    return transaction(identity.organizationId, (db) => reach(db, identity, 'rights:manage'));
  }

  async function run<Input extends z.ZodType, Output>(
    c: Ctx,
    definition: CommandDefinition<Input, Output>,
    input: unknown,
  ): Promise<Response> {
    try {
      return c.json(await runGesture(c, definition, input), 201);
    } catch (error) {
      if (error instanceof RightsRuleError) {
        throw new GestureRefusal(error.code === 'not_found' ? 404 : 409, error.code, error.message);
      }
      throw error;
    }
  }

  async function checkPermissions(c: Ctx, input: unknown): Promise<void> {
    const list = (input as { permissions?: unknown })?.permissions;
    if (!Array.isArray(list)) return;
    const { organizationId } = c.get('identity');
    const ofApps = new Set(await transaction(organizationId, appKeys));
    const unknown = list.filter((p) => typeof p === 'string' && !known.has(p) && !ofApps.has(p));
    if (unknown.length > 0) {
      throw new GestureRefusal(
        422,
        'unknown_permission',
        `Unknown permissions: ${unknown.join(', ')}`,
      );
    }
  }

  const forbidden = () =>
    new GestureRefusal(403, 'forbidden', 'This needs the « rights:manage » permission here.');

  return (
    new Hono<{ Variables: IdentityVariables }>()
      .get('/permissions', async (c) => {
        const { organizationId } = c.get('identity');
        return c.json({
          permissions: [...known].sort(),
          apps: await transaction(organizationId, apps),
        });
      })
      // What the person may do, and where.
      .get('/me', async (c) => {
        const identity = c.get('identity');
        const asOf = c.req.query('asOf') ?? today();
        const reaches = await transaction(identity.organizationId, async (db) => {
          const result: { permission: string; everywhere: boolean; units: string[] }[] = [];
          for (const permission of [...[...known].sort(), ...(await appKeys(db))]) {
            const scope = await reach(db, identity, permission, asOf);
            if (scope.everywhere || scope.units.size > 0) {
              result.push({ permission, everywhere: scope.everywhere, units: [...scope.units] });
            }
          }
          return result;
        });
        return c.json({ asOf, reaches });
      })
      .get('/', async (c) => {
        if (!(await manageReach(c)).everywhere) throw forbidden();
        const asOf = c.req.query('asOf') ?? today();
        const { organizationId } = c.get('identity');
        const [roles, grants] = await transaction(organizationId, (db) =>
          Promise.all([listRoles(db), listGrants(db, asOf)]),
        );
        return c.json({ asOf, roles, grants });
      })
      .post('/roles', async (c) => {
        if (!(await manageReach(c)).everywhere) throw forbidden();
        const input = await bodyOf(c);
        await checkPermissions(c, input);
        return run(c, createRole, input);
      })
      .post('/roles/:roleId/permissions', async (c) => {
        if (!(await manageReach(c)).everywhere) throw forbidden();
        const input = { ...((await bodyOf(c)) as object), roleId: c.req.param('roleId') };
        await checkPermissions(c, input);
        return run(c, setRolePermissionsCommand, input);
      })
      // A grant on a unit needs « rights:manage » on that unit; elsewhere, everywhere.
      .post('/grants', async (c) => {
        const input = (await bodyOf(c)) as { scopeUnitId?: unknown };
        const scopeUnit = typeof input.scopeUnitId === 'string' ? input.scopeUnitId : null;
        if (!covers(await manageReach(c), scopeUnit)) throw forbidden();
        return run(c, grantRole, input);
      })
      .post('/grants/:grantId/revoke', async (c) => {
        const grantId = c.req.param('grantId');
        const { organizationId } = c.get('identity');
        const grant = await transaction(organizationId, (db) => findGrant(db, grantId));
        if (!covers(await manageReach(c), grant?.scopeUnitId ?? null)) throw forbidden();
        return run(c, revokeGrant, { ...((await bodyOf(c)) as object), grantId });
      })
  );
}
