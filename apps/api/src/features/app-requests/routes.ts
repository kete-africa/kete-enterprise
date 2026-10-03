import { PRODUCT_HEADER, SIGNATURE_HEADER, sign, verify, type SigningKey } from '@kete/sdk';
import { newId } from '@kete/records';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runCommand, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { registerResource } from '../registry/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import {
  AppRequestRuleError,
  decideAppRequest,
  findAppRequest,
  listAppRequests,
  recordFactoryReport,
  setResource,
  submitAppRequest,
  withdrawAppRequest,
  type AppRequest,
} from './app-requests.js';
import { appRequestWords } from './words.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

const ENTERPRISE_PRODUCT = 'prd_kete_enterprise';
const FACTORY_PRODUCT = 'prd_kete_factory';
const REVIEW = 'registry:review';

/** The factory's address and the key Kete Enterprise shares with it; null when not configured. */
function factory(): { url: string; key: SigningKey } | null {
  const url = (process.env.FACTORY_URL ?? '').replace(/\/$/, '');
  const kid = process.env.FACTORY_KID ?? '';
  const secret = process.env.FACTORY_SECRET ?? '';
  return url && kid && secret.length >= 32 ? { url, key: { kid, secret } } : null;
}

async function holds(c: Ctx, permission: string): Promise<boolean> {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) =>
    reachesAnything(await reach(db, identity, permission)),
  );
}

async function refused<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof AppRequestRuleError) {
      const status =
        error.code === 'not_found'
          ? 404
          : error.code === 'not_yours' || error.code === 'own_request'
            ? 403
            : 409;
      throw new GestureRefusal(status, error.code, error.message);
    }
    throw error;
  }
}

/** Sends an approved request to the factory, signed; what happens next comes back as reports. */
async function sendToFactory(organizationId: string, request: AppRequest): Promise<string | null> {
  const target = factory();
  if (!target) return 'factory_not_configured';
  const callback = `${(process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '')}/public/factory/reports`;
  const body = JSON.stringify({
    requestId: request.requestId,
    organizationId,
    requester: { userId: request.requesterUserId, name: request.requesterName },
    app: {
      slug: request.slug,
      name: request.name,
      purpose: request.purpose,
      users: request.users,
      dataCategories: request.dataCategories,
      criticality: request.criticality,
      ownerContact: request.ownerContact,
    },
    callbackUrl: callback,
  });
  try {
    const response = await fetch(`${target.url}/v1/requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PRODUCT_HEADER]: ENTERPRISE_PRODUCT,
        [SIGNATURE_HEADER]: sign(body, target.key),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? null : `factory_${response.status}`;
  } catch {
    return 'factory_unreachable';
  }
}

async function noteSendFailure(organizationId: string, requestId: string, error: string | null) {
  await transaction(organizationId, (db) =>
    db.query(`update app_requests set error = $2, updated_at = now() where request_id = $1`, [
      requestId,
      error,
    ]),
  );
}

/** App requests, under /v1/app-requests (spec 021): everyone asks, IT decides. */
export const appRequestRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const reviews = await holds(c, REVIEW);
    return c.json(
      await transaction(organizationId, async (db) => ({
        mine: await listAppRequests(db, { requesterUserId: userId }),
        toDecide: reviews ? await listAppRequests(db, { status: 'submitted' }) : [],
        all: reviews ? await listAppRequests(db) : [],
        reviews,
        factory: factory() !== null,
      })),
    );
  })
  .post('/', async (c) => {
    const body = (await bodyOf(c)) as object;
    const output = await refused(
      runGesture(c, submitAppRequest, { ...body, requesterName: c.get('identity').name }),
    );
    return c.json(output, 201);
  })
  .post('/:requestId/withdraw', async (c) =>
    c.json(
      await refused(runGesture(c, withdrawAppRequest, { requestId: c.req.param('requestId') })),
    ),
  )
  .post('/:requestId/decide', async (c) => {
    if (!(await holds(c, REVIEW))) {
      throw new GestureRefusal(403, 'forbidden', `This needs « ${REVIEW} ».`);
    }
    const input = { ...((await bodyOf(c)) as object), requestId: c.req.param('requestId') };
    const decided = await refused(runGesture(c, decideAppRequest, input));
    if (decided.status === 'queued') {
      const { organizationId } = c.get('identity');
      const request = await transaction(organizationId, (db) =>
        findAppRequest(db, decided.requestId),
      );
      if (request)
        await noteSendFailure(
          organizationId,
          request.requestId,
          await sendToFactory(organizationId, request),
        );
    }
    return c.json(decided);
  })
  // IT sends an approved request again, when the factory could not be reached.
  .post('/:requestId/send', async (c) => {
    if (!(await holds(c, REVIEW))) {
      throw new GestureRefusal(403, 'forbidden', `This needs « ${REVIEW} ».`);
    }
    const { organizationId } = c.get('identity');
    const request = await transaction(organizationId, (db) =>
      findAppRequest(db, c.req.param('requestId')),
    );
    if (!request) throw new GestureRefusal(404, 'not_found', 'No such request.');
    if (request.status !== 'queued' && request.status !== 'failed') {
      throw new GestureRefusal(409, 'wrong_step', 'Only an approved request waiting is sent.');
    }
    const error = await sendToFactory(organizationId, request);
    await noteSendFailure(organizationId, request.requestId, error);
    if (error) throw new GestureRefusal(409, error, 'The factory did not take it.');
    return c.json({ requestId: request.requestId, status: 'queued' });
  });

const report = z.object({
  requestId: z.string().regex(/^apr_[0-9a-z-]{8,64}$/),
  organizationId: z.string().regex(/^org_[\w-]{4,64}$/),
  status: z.enum(['building', 'ready', 'coding', 'review', 'failed']),
  repository: z.string().max(200).nullable(),
  url: z.string().url().nullable(),
  pullRequest: z.string().url().nullable(),
  error: z.string().max(2000).nullable(),
});

/** Puts a task in a person's To do (spec 018): the factory's news, where she works. */
async function task(
  organizationId: string,
  userId: string,
  key: string,
  title: string,
  href: string,
) {
  await transaction(organizationId, (db) =>
    db.query(
      `insert into app_tasks (task_id, organization_id, user_id, source, key, title, href)
       values ($1, $2, $3, 'kete-factory', $4, $5, $6)
       on conflict (organization_id, user_id, source, key) do update
         set title = excluded.title, href = excluded.href, status = 'open', updated_at = now()`,
      [newId('tsk'), organizationId, userId, key, title, href],
    ),
  );
}

/** The factory's reports, under /public/factory (spec 021): signed, never from a person. */
export const factoryReportRoutes = new Hono().post('/reports', async (c) => {
  const target = factory();
  if (!target) return c.json({ error: 'not_configured' }, 404);
  const body = await c.req.text();
  const signed = verify(
    {
      product: c.req.header(PRODUCT_HEADER) ?? null,
      signature: c.req.header(SIGNATURE_HEADER) ?? null,
      body,
    },
    new Map([[FACTORY_PRODUCT, [target.key]]]),
  );
  if (!signed.ok) return c.json({ error: 'invalid_signature' }, 401);
  const parsed = report.safeParse(JSON.parse(body));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 422);
  const r = parsed.data;
  const request = await transaction(r.organizationId, (db) => recordFactoryReport(db, r));
  if (!request) return c.json({ error: 'not_found' }, 404);
  const words = appRequestWords('fr');
  const web = (process.env.PUBLIC_WEB_URL ?? '').replace(/\/$/, '');
  if (r.status === 'ready' && r.url && !request.resourceId) {
    // The app enters the registry in the space of the person who asked: she owns it.
    const created = await runCommand(
      r.organizationId,
      {
        kind: 'service',
        id: 'svc_factory',
        channel: 'api',
        onBehalfOf: { kind: 'person', id: request.requesterUserId },
      },
      `factory-ready-${request.requestId}`,
      registerResource,
      {
        kind: 'app',
        name: request.name,
        description: request.purpose.slice(0, 400),
        address: r.url,
        ownerName: request.requesterName,
      },
    );
    await transaction(r.organizationId, (db) =>
      setResource(db, request.requestId, (created as { resourceId: string }).resourceId),
    );
    await task(
      r.organizationId,
      request.requesterUserId,
      request.requestId,
      words.ready(request.name),
      r.url,
    );
  }
  if (r.status === 'review' && r.pullRequest && request.decidedBy) {
    await task(
      r.organizationId,
      request.decidedBy,
      `${request.requestId}-review`,
      words.review(request.name),
      r.pullRequest,
    );
  }
  if (r.status === 'failed') {
    await task(
      r.organizationId,
      request.decidedBy ?? request.requesterUserId,
      `${request.requestId}-failed`,
      words.failed(request.name),
      `${web}/ressources/demandes`,
    );
  }
  return c.json({ ok: true });
});
