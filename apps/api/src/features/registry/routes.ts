import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { covers, reach, unitsOfPersonAndAbove, type Reach } from '../rights/index.js';
import {
  decidePromotion,
  refreshIdentityCard,
  registerResource,
  RegistryRuleError,
  requestPromotion,
  retireResource,
} from './commands.js';
import { readIdentityCard, type CardReader } from './infrastructure/identity-card.js';
import {
  findPromotion,
  findResource,
  listPendingPromotions,
  listResources,
} from './infrastructure/registry.tables.js';
import { registerInput, type Promotion, type Resource, type Tier } from './registry.record.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 004). */
export const registryPermissions = ['registry:read', 'registry:review'] as const;

let readCard: CardReader = readIdentityCard;

/** Tests: read identity cards another way. */
export function useCardReader(next: CardReader): void {
  readCard = next;
}

const unitOf = (tier: Tier): string | null => (tier.kind === 'unit' ? tier.unitId : null);

/** What the inventory flags: an app or an MCP server without a card, or a card without an owner. */
export function flagsOf(resource: Resource): ('no_card' | 'no_owner')[] {
  if (resource.kind !== 'app' && resource.kind !== 'mcp') return [];
  if (!resource.card) return ['no_card'];
  return resource.card.governance?.owner.name ? [] : ['no_owner'];
}

interface Reaches {
  read: Reach;
  review: Reach;
  above: Set<string>;
}

async function reachesOf(c: Ctx, db: SqlExecutor): Promise<Reaches> {
  const identity = c.get('identity');
  const [read, review, above] = await Promise.all([
    reach(db, identity, 'registry:read'),
    reach(db, identity, 'registry:review'),
    unitsOfPersonAndAbove(db, identity),
  ]);
  return { read, review, above };
}

/** Whether the person sees a resource: hers, shared with her units, or in her reach. */
function sees(resource: Resource, me: string, r: Reaches): boolean {
  if (resource.ownerUserId === me || resource.tier.kind === 'organization') return true;
  if (r.read.everywhere || r.review.everywhere) return true;
  const unit = unitOf(resource.tier);
  return unit !== null && (r.above.has(unit) || covers(r.read, unit) || covers(r.review, unit));
}

/** Whether the person may decide a promotion: a reviewer of its target, never of her own request. */
function mayDecide(promotion: Promotion, resource: Resource | null, me: string, r: Reaches) {
  if (!resource || promotion.requestedBy === me) return false;
  // A high-risk resource is promoted by a reviewer of the whole organization only.
  if (resource.risk === 'high') return r.review.everywhere;
  return covers(r.review, unitOf(promotion.target));
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Response> {
  try {
    return c.json(await runGesture(c, definition, input), 201);
  } catch (error) {
    if (error instanceof RegistryRuleError) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 409, error.code, error.message);
    }
    throw error;
  }
}

const forbidden = (message: string) => new GestureRefusal(403, 'forbidden', message);

/** The owner, or a reviewer of the resource's tier. */
async function ownerOrReviewer(c: Ctx, resourceId: string): Promise<Resource> {
  const { organizationId, userId } = c.get('identity');
  const found = await transaction(organizationId, async (db) => ({
    resource: await findResource(db, resourceId),
    reaches: await reachesOf(c, db),
  }));
  if (!found.resource) throw new GestureRefusal(404, 'not_found', 'No such resource here.');
  const { resource, reaches } = found;
  if (resource.ownerUserId !== userId && !covers(reaches.review, unitOf(resource.tier))) {
    throw forbidden('Only its owner or a reviewer of its tier may do this.');
  }
  return resource;
}

/** The registry's routes, under /v1/registry (spec 004). */
export const registryRoutes = new Hono<{ Variables: IdentityVariables }>()
  // My resources, the inventory in my reach (with its flags), and the promotions I may decide.
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const screen = await transaction(organizationId, async (db) => {
      const reaches = await reachesOf(c, db);
      const all = await listResources(db);
      const byId = new Map(all.map((r) => [r.resourceId, r]));
      const resources = all.filter((r) => sees(r, userId, reaches));
      const pending = await listPendingPromotions(db);
      // A request comes with what it is about: a reviewer decides on a resource she may not see yet.
      const withResource = (p: Promotion) => {
        const resource = byId.get(p.resourceId);
        return {
          ...p,
          resource: resource
            ? {
                name: resource.name,
                kind: resource.kind,
                risk: resource.risk,
                ownerName: resource.ownerName,
              }
            : null,
        };
      };
      return {
        resources: resources.map((r) => ({ ...r, flags: flagsOf(r) })),
        toDecide: pending
          .filter((p) => mayDecide(p, byId.get(p.resourceId) ?? null, userId, reaches))
          .map(withResource),
        mine: pending.filter((p) => p.requestedBy === userId).map(withResource),
        reviews: reaches.review.everywhere || reaches.review.units.size > 0,
      };
    });
    return c.json(screen);
  })
  // Anyone registers a resource, in her own space; the API reads an app's card itself.
  .post('/resources', async (c) => {
    const parsed = registerInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', parsed.error.message);
    const card = parsed.data.address ? await readCard(parsed.data.address) : null;
    return run(c, registerResource, {
      ...parsed.data,
      ownerName: c.get('identity').name,
      card,
    });
  })
  .post('/resources/:resourceId/refresh', async (c) => {
    const resource = await ownerOrReviewer(c, c.req.param('resourceId'));
    const card = resource.address ? await readCard(resource.address) : null;
    return run(c, refreshIdentityCard, { resourceId: resource.resourceId, card });
  })
  .post('/resources/:resourceId/retire', async (c) => {
    const resource = await ownerOrReviewer(c, c.req.param('resourceId'));
    return run(c, retireResource, { resourceId: resource.resourceId });
  })
  // Its owner asks; a reviewer of the target decides.
  .post('/resources/:resourceId/promotions', async (c) => {
    const resourceId = c.req.param('resourceId');
    const { organizationId, userId } = c.get('identity');
    const resource = await transaction(organizationId, (db) => findResource(db, resourceId));
    if (!resource) throw new GestureRefusal(404, 'not_found', 'No such resource here.');
    if (resource.ownerUserId !== userId) throw forbidden('Only its owner asks for a promotion.');
    const body = (await bodyOf(c)) as Record<string, unknown>;
    return run(c, requestPromotion, { ...body, resourceId });
  })
  .post('/promotions/:promotionId/decide', async (c) => {
    const promotionId = c.req.param('promotionId');
    const { organizationId, userId } = c.get('identity');
    const allowed = await transaction(organizationId, async (db) => {
      const promotion = await findPromotion(db, promotionId);
      if (!promotion) return null;
      const resource = await findResource(db, promotion.resourceId);
      return { promotion, ok: mayDecide(promotion, resource, userId, await reachesOf(c, db)) };
    });
    if (!allowed) throw new GestureRefusal(404, 'not_found', 'No such promotion here.');
    if (!allowed.ok) {
      if (allowed.promotion.requestedBy === userId) {
        throw new GestureRefusal(409, 'own_request', 'A person does not decide her own request.');
      }
      throw forbidden('This needs « registry:review » on the target (everywhere for high risk).');
    }
    const body = (await bodyOf(c)) as Record<string, unknown>;
    return run(c, decidePromotion, { ...body, promotionId });
  });
