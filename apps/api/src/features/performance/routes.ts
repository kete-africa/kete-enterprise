import type { Actor, CommandDefinition } from '@kete/commands';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runCommand, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readModules, requireModule } from '../organization/index.js';
import { requirePass, type PassVariables } from '../passes/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import { personOfAccount } from '../structure/index.js';
import {
  acknowledgeGrid,
  assignProfile,
  closeMeasures,
  closeQuarter,
  createQuarter,
  importReferential,
  measureFromSurvey,
  openQuarter,
  PerformanceRuleError,
  recordMeasure,
  reviewPurpose,
  setCollectiveFactor,
  setGroupFactor,
  signReview,
  validateReview,
  writeRecord,
} from './commands.js';
import {
  findQuarter,
  findReview,
  listProfiles,
  listQuarters,
  listReviews,
} from './infrastructure/performance.tables.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 012). */
export const performancePermissions = [
  'performance:manage',
  'performance:measure',
  'performance:validate',
  'performance:read',
] as const;
type Permission = (typeof performancePermissions)[number];

const statusOf: Record<PerformanceRuleError['code'], 403 | 404 | 409 | 422> = {
  not_found: 404,
  not_draft: 409,
  not_open: 409,
  not_measured: 409,
  wrong_step: 409,
  not_reviewer: 403,
  not_yours: 403,
  weights: 422,
  nobody: 422,
};

async function refused<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof PerformanceRuleError) {
      throw new GestureRefusal(statusOf[error.code], error.code, error.message);
    }
    throw error;
  }
}

async function holds(c: Ctx, permissions: Permission[]): Promise<boolean> {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) => {
    for (const permission of permissions) {
      if (reachesAnything(await reach(db, identity, permission))) return true;
    }
    return false;
  });
}

async function requireAny(c: Ctx, permissions: Permission[]): Promise<void> {
  if (!(await holds(c, permissions))) {
    throw new GestureRefusal(403, 'forbidden', `This needs ${permissions.join(' or ')}.`);
  }
}

function gesture<Input extends z.ZodType, Output>(
  permissions: Permission[],
  definition: CommandDefinition<Input, Output>,
  param?: string,
  relay = false,
) {
  return async (c: Ctx) => {
    await requireAny(c, permissions);
    const input = {
      ...((await bodyOf(c)) as object),
      ...(param ? { [param]: c.req.param(param) } : {}),
      ...(relay ? { relayEmail: c.get('identity').email || null } : {}),
    };
    return c.json(await refused(runGesture(c, definition, input)), 201);
  };
}

/** A gesture on one's own review, or one's report's: the API says who acts, never the caller. */
function onReview<Input extends z.ZodType, Output>(definition: CommandDefinition<Input, Output>) {
  return async (c: Ctx) => {
    const identity = c.get('identity');
    const person = await transaction(identity.organizationId, (db) =>
      personOfAccount(db, identity.userId),
    );
    const manages = await holds(c, ['performance:manage']);
    if (!person && !manages) {
      throw new GestureRefusal(403, 'forbidden', 'You have no person in this organization.');
    }
    const input = {
      ...((await bodyOf(c)) as object),
      reviewId: c.req.param('reviewId'),
      actingPersonId: person?.personId ?? 'prs_00000000',
      manages,
      relayEmail: identity.email || null,
    };
    return c.json(await refused(runGesture(c, definition, input)), 201);
  };
}

/** The performance routes for people signed in, under /v1/performance (spec 012). */
export const performanceRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('performance'))
  .get('/', async (c) => {
    await requireAny(c, [
      'performance:manage',
      'performance:measure',
      'performance:validate',
      'performance:read',
    ]);
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({ quarters: await listQuarters(db) })),
    );
  })
  .get('/profiles', async (c) => {
    await requireAny(c, ['performance:manage', 'performance:measure', 'performance:read']);
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({ profiles: await listProfiles(db) })),
    );
  })
  .post('/referential', gesture(['performance:manage'], importReferential))
  .post(
    '/positions/:positionId/profile',
    gesture(['performance:manage'], assignProfile, 'positionId'),
  )
  .post('/quarters', gesture(['performance:manage'], createQuarter))
  .get('/quarters/:quarterId', async (c) => {
    await requireAny(c, [
      'performance:manage',
      'performance:measure',
      'performance:validate',
      'performance:read',
    ]);
    const { organizationId } = c.get('identity');
    const answer = await transaction(organizationId, async (db) => {
      const quarter = await findQuarter(db, c.req.param('quarterId'));
      if (!quarter) return null;
      return { quarter, reviews: await listReviews(db, { quarterId: quarter.quarterId }, true) };
    });
    if (!answer) throw new GestureRefusal(404, 'not_found', 'No such quarter.');
    return c.json(answer);
  })
  .post(
    '/quarters/:quarterId/open',
    gesture(['performance:manage'], openQuarter, 'quarterId', true),
  )
  .post('/quarters/:quarterId/units/:unitId', async (c) => {
    await requireAny(c, ['performance:measure']);
    const input = {
      ...((await bodyOf(c)) as object),
      quarterId: c.req.param('quarterId'),
      unitId: c.req.param('unitId'),
    };
    return c.json(await refused(runGesture(c, setCollectiveFactor, input)), 201);
  })
  .post('/quarters/:quarterId/group', gesture(['performance:measure'], setGroupFactor, 'quarterId'))
  .post(
    '/quarters/:quarterId/close-measures',
    gesture(['performance:measure'], closeMeasures, 'quarterId'),
  )
  .post('/quarters/:quarterId/close', gesture(['performance:manage'], closeQuarter, 'quarterId'))
  .post('/reviews/:reviewId/measures', gesture(['performance:measure'], recordMeasure, 'reviewId'))
  .post(
    '/reviews/:reviewId/from-survey',
    gesture(['performance:measure'], measureFromSurvey, 'reviewId'),
  )
  .post(
    '/reviews/:reviewId/validate',
    gesture(['performance:validate'], validateReview, 'reviewId'),
  )
  .post('/reviews/:reviewId/acknowledge', onReview(acknowledgeGrid))
  .post('/reviews/:reviewId/record', onReview(writeRecord))
  .post('/reviews/:reviewId/sign', onReview(signReview))
  .get('/reviews/:reviewId', async (c) => {
    const identity = c.get('identity');
    const review = await transaction(identity.organizationId, async (db) => {
      const found = await findReview(db, c.req.param('reviewId'));
      if (!found) return null;
      const person = await personOfAccount(db, identity.userId);
      const mine =
        person && (found.personId === person.personId || found.managerPersonId === person.personId);
      return mine ? found : null;
    });
    if (review) return c.json({ review });
    // Whoever runs, measures, validates or reads the quarters sees every review.
    await requireAny(c, [
      'performance:manage',
      'performance:measure',
      'performance:validate',
      'performance:read',
    ]);
    const any = await transaction(identity.organizationId, (db) =>
      findReview(db, c.req.param('reviewId')),
    );
    if (!any) throw new GestureRefusal(404, 'not_found', 'No such review.');
    return c.json({ review: any });
  })
  // The person's own reviews, and those of the people she manages.
  .get('/mine', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const person = await personOfAccount(db, identity.userId);
        if (!person) return { reviews: [], team: [] };
        return {
          reviews: await listReviews(db, { personId: person.personId }, true),
          team: await listReviews(db, { managerPersonId: person.personId }, true),
        };
      }),
    );
  });

type PassCtx = Context<{ Variables: PassVariables }>;

function linkActor(c: PassCtx): Actor {
  return { kind: 'person', id: c.get('pass').personId ?? 'unknown', channel: 'web' };
}

async function moduleOn(c: PassCtx): Promise<void> {
  const modules = await transaction(c.get('pass').organizationId, (db) => readModules(db));
  if (!modules.performance) {
    throw new GestureRefusal(403, 'module_disabled', 'Performance is not on here.');
  }
}

function byLink<Input extends z.ZodType, Output>(definition: CommandDefinition<Input, Output>) {
  return async (c: PassCtx) => {
    await moduleOn(c);
    const pass = c.get('pass');
    const input = {
      ...((await bodyOf(c)) as object),
      reviewId: pass.reference,
      actingPersonId: pass.personId ?? 'prs_00000000',
      manages: false,
      relayEmail: null,
    };
    return c.json(
      await refused(
        runCommand(
          pass.organizationId,
          linkActor(c),
          c.req.header('idempotency-key'),
          definition,
          input,
        ),
      ),
      201,
    );
  };
}

/** A review's personal link, under /public/performance/:token: her grid and her record, no more. */
export const performancePublicRoutes = new Hono<{ Variables: PassVariables }>()
  .use('/:token', requirePass(reviewPurpose))
  .use('/:token/*', requirePass(reviewPurpose))
  .get('/:token', async (c) => {
    await moduleOn(c);
    const pass = c.get('pass');
    const answer = await transaction(pass.organizationId, async (db) => {
      const review = await findReview(db, pass.reference);
      if (!review) return null;
      return { review, quarter: await findQuarter(db, review.quarterId) };
    });
    if (!answer?.quarter) throw new GestureRefusal(404, 'link_invalid', 'No such review.');
    return c.json(answer);
  })
  .post('/:token/acknowledge', byLink(acknowledgeGrid))
  .post('/:token/sign', byLink(signReview));
