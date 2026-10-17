import { Hono } from 'hono';
import { z } from 'zod';
import { fluidity, forMe, getHolding, handBack, HoldingError, type Holding } from '@kete/work';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { notificationWords, tell } from '../notifications/index.js';
import { isAdministrator } from '../rights/index.js';
import { hrefOf } from './links.js';
import { centerStructure } from './structure.js';
import { syncHoldings } from './sync.js';

// « Pour moi », handing back, the figures (spec 087, FR-003 to FR-005).

const shown = (holding: Holding) => ({ ...holding, href: hrefOf(holding) });

const isHolding = z.string().regex(/^hld_[0-9A-Za-z_-]{4,70}$/);
const handBackInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** Her holdings: under /v1/pour-moi. */
export const forMeRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const mine = await transaction(organizationId, async (db) => {
      await syncHoldings(db, organizationId);
      return forMe(db, userId);
    });
    return c.json({
      toAnswer: mine.toAnswer.map(shown),
      held: mine.held.map(shown),
      information: mine.information.map(shown),
    });
  })
  .post('/:holdingId/rendre', async (c) => {
    const identity = c.get('identity');
    if (c.get('viewedBy')) {
      throw new GestureRefusal(403, 'view_as_forbidden', 'Only the person hands back her work.');
    }
    const id = isHolding.safeParse(c.req.param('holdingId'));
    const input = handBackInput.safeParse(await bodyOf(c));
    if (!id.success || !input.success) {
      throw new GestureRefusal(422, 'invalid_input', 'A holding and a reason are expected.');
    }
    const back = await transaction(identity.organizationId, async (db) => {
      try {
        const holding = await handBack(db, identity.organizationId, {
          holdingId: id.data,
          by: { kind: 'person', id: identity.userId },
          reason: input.data.reason,
        });
        if (holding.holder.kind === 'person') {
          const center = await centerStructure(db);
          await tell(db, identity.organizationId, holding.holder.id, {
            kind: 'holding.handed_back',
            title: notificationWords().holdingHandedBack(
              center.nameOf(identity.userId),
              holding.what,
              input.data.reason,
            ),
            href: shown(holding).href,
          });
        }
        return holding;
      } catch (error) {
        if (error instanceof HoldingError) {
          const found = await getHolding(db, id.data);
          throw new GestureRefusal(found ? 409 : 404, error.code, error.message);
        }
        throw error;
      }
    });
    return c.json({ holding: shown(back) });
  });

/** The organization's fluidity: under /v1/work, for its administrators. */
export const workRoutes = new Hono<{ Variables: IdentityVariables }>().get(
  '/figures',
  async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) {
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    }
    const figures = await transaction(identity.organizationId, async (db) => {
      await syncHoldings(db, identity.organizationId);
      return fluidity(db);
    });
    return c.json({
      ...figures,
      oldestWait: figures.oldestWait
        ? { ...figures.oldestWait, holding: shown(figures.oldestWait.holding) }
        : null,
    });
  },
);
