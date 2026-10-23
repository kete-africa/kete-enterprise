import { Hono } from 'hono';
import { z } from 'zod';
import {
  fluidity,
  forMe,
  getHolding,
  handBack,
  HoldingError,
  prioritize,
  priorities,
  snoozeHolding,
  type Holding,
  type Priority,
} from '@kete/work';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { keepAttention, notificationWords, tell } from '../notifications/index.js';
import { isAdministrator } from '../rights/index.js';
import { settingsFor } from '../settings/index.js';
import { hrefOf } from './links.js';
import { centerStructure } from './structure.js';
import { syncHoldings } from './sync.js';

// « Pour moi », handing back, the figures (spec 087, FR-003 to FR-005).

const shown = (holding: Holding) => ({ ...holding, href: hrefOf(holding) });

const isHolding = z.string().regex(/^hld_[0-9A-Za-z_-]{4,70}$/);
const handBackInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** Only its holder changes how urgent a holding is, or when it comes back. */
async function mine(db: Parameters<typeof getHolding>[0], userId: string, holdingId: string) {
  const holding = await getHolding(db, holdingId);
  if (!holding) throw new GestureRefusal(404, 'not_found', 'No such holding here.');
  if (holding.holder.kind !== 'person' || holding.holder.id !== userId) {
    throw new GestureRefusal(403, 'not_yours', 'Its holder decides that.');
  }
  return holding;
}

/** Her holdings: under /v1/pour-moi. */
export const forMeRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? null;
    const mine = await transaction(organizationId, async (db) => {
      await syncHoldings(db, organizationId);
      // Her choice of a threads' summary by mail, kept for the worker (spec 098, FR-014).
      if (token && !c.get('viewedBy')) {
        const settings = await settingsFor(db, { token });
        const digest = settings.value('kete.threads_digest') === 'daily' ? 'daily' : 'none';
        await db.query(`update people set threads_digest = $2 where account_user_id = $1`, [
          userId,
          digest,
        ]);
        // Her choices for her attention, for the worker that has no token of hers (spec 109).
        await keepAttention(db, userId, {
          quietHours: settings.value<{ from: string; to: string } | null>('kete.quiet_hours'),
          timeZone: settings.value<string>('kete.time_zone'),
          channels: settings.value<string[]>('kete.notification_channels'),
          digest,
        });
      }
      return forMe(db, userId);
    });
    return c.json({
      toAnswer: mine.toAnswer.map(shown),
      held: mine.held.map(shown),
      information: mine.information.map(shown),
    });
  })
  // She says how urgent it is, or puts it off until a moment (spec 098, FR-017).
  .post('/:holdingId/priorite', async (c) => {
    const identity = c.get('identity');
    const id = isHolding.safeParse(c.req.param('holdingId'));
    const input = z
      .object({ priority: z.enum(priorities as unknown as [Priority, ...Priority[]]) })
      .safeParse(await bodyOf(c));
    if (!id.success || !input.success) {
      throw new GestureRefusal(422, 'invalid_input', 'A holding and a priority are expected.');
    }
    const holding = await transaction(identity.organizationId, async (db) => {
      await mine(db, identity.userId, id.data);
      return prioritize(db, identity.organizationId, {
        holdingId: id.data,
        priority: input.data.priority,
      });
    });
    return c.json({ holding: shown(holding) });
  })
  .post('/:holdingId/reporter', async (c) => {
    const identity = c.get('identity');
    const id = isHolding.safeParse(c.req.param('holdingId'));
    const input = z.object({ until: z.iso.datetime().nullable() }).safeParse(await bodyOf(c));
    if (!id.success || !input.success) {
      throw new GestureRefusal(422, 'invalid_input', 'A holding and a moment are expected.');
    }
    const holding = await transaction(identity.organizationId, async (db) => {
      await mine(db, identity.userId, id.data);
      return snoozeHolding(db, identity.organizationId, {
        holdingId: id.data,
        until: input.data.until ? new Date(input.data.until) : null,
      });
    });
    return c.json({ holding: shown(holding) });
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
