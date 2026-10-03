import { PRODUCT_HEADER, SIGNATURE_HEADER, sign } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 021: a person asks for an app; IT decides, never on her own request; the factory creates it
// and reports each step, signed; the app enters the registry in the requester's space, and the news
// reaches the To do of whoever must act.

let db: TestSchema;
const api = createApi();
const t = { ama: '', kofi: '', abla: '' };
let key = 0;
const factoryKey = { kid: 'fk1', secret: 'a-shared-secret-of-at-least-32-bytes!!' };

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `apr-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

async function report(body: object, key = factoryKey) {
  const text = JSON.stringify(body);
  const response = await api.request('/public/factory/reports', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [PRODUCT_HEADER]: 'prd_kete_factory',
      [SIGNATURE_HEADER]: sign(text, key),
    },
    body: text,
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const request = {
  slug: 'fieldwork',
  name: 'Interventions',
  purpose: 'Planifier les techniciens sur les sites clients et suivre leurs interventions.',
  users: 'Les techniciens et le chef de service SAV',
  dataCategories: ['personal', 'location'],
  criticality: 'medium',
  ownerContact: 'abla@example.test',
};

const sent: { url: string; body: Answer }[] = [];

beforeAll(async () => {
  db = await startApi();
  process.env.FACTORY_URL = 'https://factory.kete.test';
  process.env.FACTORY_KID = factoryKey.kid;
  process.env.FACTORY_SECRET = factoryKey.secret;
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address.startsWith('https://factory.kete.test')) {
      sent.push({ url: address, body: JSON.parse(String(init?.body)) as Answer });
      return Response.json({ ok: true }, { status: 202 });
    }
    // The registry reads the new app's card: it has none yet.
    if (address.includes('fieldwork')) return new Response('not found', { status: 404 });
    return real(url, init);
  });
  t.ama = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.abla = await tokenFor('usr_abla', { name: 'Abla' });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.drop();
});

describe('a request for an app', () => {
  let requestId = '';

  it('is asked by anyone, and seen by her and by IT', async () => {
    const asked = await call(t.abla, 'POST', '/app-requests', request);
    expect(asked.status).toBe(201);
    requestId = asked.body.requestId as string;
    const hers = (await call(t.abla, 'GET', '/app-requests')).body;
    expect(hers).toMatchObject({ reviews: false, toDecide: [], factory: true });
    expect(hers.mine).toEqual([
      expect.objectContaining({ requestId, status: 'submitted', requesterName: 'Abla' }),
    ]);
    const it = (await call(t.ama, 'GET', '/app-requests')).body;
    expect(it.toDecide).toEqual([expect.objectContaining({ requestId })]);
  });

  it('is read by her and by IT only', async () => {
    expect((await call(t.abla, 'GET', `/app-requests/${requestId}`)).body).toMatchObject({
      request: { requestId, slug: 'fieldwork' },
      reviews: false,
    });
    expect((await call(t.ama, 'GET', `/app-requests/${requestId}`)).status).toBe(200);
    expect((await call(t.kofi, 'GET', `/app-requests/${requestId}`)).status).toBe(404);
  });

  it('is refused twice under the same name', async () => {
    const again = await call(t.kofi, 'POST', '/app-requests', request);
    expect(again).toMatchObject({ status: 409, body: { error: 'duplicate' } });
  });

  it('is decided by IT only, never by the person who asked', async () => {
    const kofi = await call(t.kofi, 'POST', `/app-requests/${requestId}/decide`, {
      decision: 'approve',
    });
    expect(kofi.status).toBe(403);
    const own = await call(t.ama, 'POST', '/app-requests', { ...request, slug: 'assets-ama' });
    const refused = await call(
      t.ama,
      'POST',
      `/app-requests/${own.body.requestId as string}/decide`,
      { decision: 'approve' },
    );
    expect(refused).toMatchObject({ status: 403, body: { error: 'own_request' } });
  });

  it('goes to the factory once approved, signed', async () => {
    const decided = await call(t.ama, 'POST', `/app-requests/${requestId}/decide`, {
      decision: 'approve',
    });
    expect(decided.body).toMatchObject({ requestId, status: 'queued' });
    expect(sent).toEqual([
      expect.objectContaining({
        url: 'https://factory.kete.test/v1/requests',
        body: expect.objectContaining({
          requestId,
          organizationId: 'org_kya',
          requester: { userId: 'usr_abla', name: 'Abla' },
          app: expect.objectContaining({ slug: 'fieldwork', criticality: 'medium' }),
        }),
      }),
    ]);
    // Withdrawing comes too late once decided.
    const late = await call(t.abla, 'POST', `/app-requests/${requestId}/withdraw`);
    expect(late.status).toBe(409);
  });

  it('takes only the factory’s signed reports', async () => {
    const forged = await report(
      {
        requestId,
        organizationId: 'org_kya',
        status: 'ready',
        repository: null,
        url: 'https://kete-fieldwork.apps.kete.test',
        pullRequest: null,
        error: null,
      },
      { kid: factoryKey.kid, secret: 'another-secret-of-at-least-32-bytes!!!' },
    );
    expect(forged.status).toBe(401);
  });

  it('puts the ready app in the registry, in the requester’s space, and tells her', async () => {
    const ready = await report({
      requestId,
      organizationId: 'org_kya',
      status: 'ready',
      repository: 'kete-africa/kete-fieldwork',
      url: 'https://kete-fieldwork.apps.kete.test',
      pullRequest: null,
      error: null,
    });
    expect(ready.status).toBe(200);
    const hers = (await call(t.abla, 'GET', '/app-requests')).body.mine as Answer[];
    expect(hers[0]).toMatchObject({
      status: 'ready',
      url: 'https://kete-fieldwork.apps.kete.test',
      resourceId: expect.stringMatching(/^res_/),
    });
    const tasks = (await call(t.abla, 'GET', '/workspace/tasks')).body.tasks as Answer[];
    expect(tasks).toEqual([
      expect.objectContaining({
        source: 'kete-factory',
        href: 'https://kete-fieldwork.apps.kete.test',
      }),
    ]);
    // A report sent again changes nothing: one resource only.
    await report({
      requestId,
      organizationId: 'org_kya',
      status: 'ready',
      repository: null,
      url: 'https://kete-fieldwork.apps.kete.test',
      pullRequest: null,
      error: null,
    });
    const again = (await call(t.abla, 'GET', '/app-requests')).body.mine as Answer[];
    expect(again[0]?.resourceId).toBe(hers[0]?.resourceId);
  });

  it('asks IT to review the first version, and says when it failed', async () => {
    await report({
      requestId,
      organizationId: 'org_kya',
      status: 'review',
      repository: null,
      url: null,
      pullRequest: 'https://github.com/kete-africa/kete-fieldwork/pull/1',
      error: null,
    });
    const its = (await call(t.ama, 'GET', '/workspace/tasks')).body.tasks as Answer[];
    expect(its).toEqual([
      expect.objectContaining({ href: 'https://github.com/kete-africa/kete-fieldwork/pull/1' }),
    ]);
  });

  it('is withdrawn by its requester while undecided', async () => {
    const asked = await call(t.kofi, 'POST', '/app-requests', { ...request, slug: 'inventory' });
    const id = asked.body.requestId as string;
    expect((await call(t.abla, 'POST', `/app-requests/${id}/withdraw`)).status).toBe(403);
    expect((await call(t.kofi, 'POST', `/app-requests/${id}/withdraw`)).body).toMatchObject({
      status: 'withdrawn',
    });
  });
});
