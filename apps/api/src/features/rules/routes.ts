import { Hono, type Context } from 'hono';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import {
  appliedFamilies,
  createRule,
  lastMonth,
  listRules,
  refusals,
  RuleError,
  ruleFamilies,
  setRuleState,
  simulate,
} from './rules.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

function administrator(c: Ctx): void {
  if (!isAdministrator(c.get('identity'))) {
    throw new GestureRefusal(403, 'forbidden', 'Only administrators set the rules.');
  }
}

function refuse(error: unknown): never {
  if (error instanceof RuleError) {
    const status = { not_found: 404, not_tried: 409, family_later: 422, unknown_permission: 422 };
    throw new GestureRefusal(status[error.code] as 404, error.code, error.message);
  }
  throw error;
}

/**
 * The organization's rules for its agents, under /v1/rules (spec 068): administrators write them,
 * try them on the last month, switch them on — and read what they refused.
 */
export function rulesRoutes(permissions: readonly string[]) {
  const known = new Set(permissions);
  return (
    new Hono<{ Variables: IdentityVariables }>()
      .get('/', async (c: Ctx) => {
        administrator(c);
        const { organizationId } = c.get('identity');
        return c.json(
          await transaction(organizationId, async (db) => {
            const counts = await lastMonth(db);
            return {
              rules: (await listRules(db)).map((rule) => ({
                ...rule,
                lastMonth: counts.get(rule.ruleId) ?? { refused: 0, counted: 0 },
              })),
              families: ruleFamilies.map((family) => ({
                family,
                applied: (appliedFamilies as readonly string[]).includes(family),
              })),
              permissions: [...known].sort(),
            };
          }),
        );
      })
      .post('/', async (c: Ctx) => {
        administrator(c);
        const input = (await bodyOf(c)) as { permissions?: unknown } | null;
        const asked = Array.isArray(input?.permissions) ? input.permissions : [];
        if (asked.some((permission) => typeof permission === 'string' && !known.has(permission))) {
          throw new GestureRefusal(422, 'unknown_permission', 'A permission that does not exist.');
        }
        return c.json({ rule: await runGesture(c, createRule, input).catch(refuse) }, 201);
      })
      // Tried on the last month: what it would have refused. It may then be switched on.
      .post('/:ruleId/simulate', async (c: Ctx) => {
        administrator(c);
        const { organizationId } = c.get('identity');
        const simulation = await transaction(organizationId, (db) =>
          simulate(db, c.req.param('ruleId') ?? ''),
        );
        if (!simulation) throw new GestureRefusal(404, 'not_found', 'No such rule here.');
        return c.json({ simulation });
      })
      .post('/:ruleId/state', async (c: Ctx) => {
        administrator(c);
        const body = (await bodyOf(c)) as object | null;
        const changed = await runGesture(c, setRuleState, {
          ...body,
          ruleId: c.req.param('ruleId'),
        }).catch(refuse);
        return c.json(changed);
      })
      // The evidence: every refusal, with the rule that refused.
      .get('/refusals', async (c: Ctx) => {
        administrator(c);
        const { organizationId } = c.get('identity');
        return c.json({ refusals: await transaction(organizationId, (db) => refusals(db)) });
      })
  );
}
