import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 023, part 2: an app asks a decision for a person; the organization's circuit finds who
// decides — her manager by the structure; the person decides in her Inbox; the app is told its id
// only and reads the outcome with its own token.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '', kossi: '' };
let key = 0;
const told: { url: string; body: unknown }[] = [];

const card: IdentityCard = {
  product: 'prd_kete_purchases',
  name: 'Achats',
  version: '1.0.0',
  client: 'cli_purchases',
  subjects: [
    {
      name: 'purchase',
      label: { fr: 'Achat', en: 'Purchase' },
      measure: { fr: 'Montant (FCFA)', en: 'Amount (FCFA)' },
    },
  ],
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `app-decision-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const admin = async (path: string, body: object) =>
  (await call(t.admin, 'POST', `/v1${path}`, body)).body;

beforeAll(async () => {
  db = await startApi();
  useAppVerifier(async (token) => {
    if (!token.startsWith('app:')) throw new Error('not an app');
    return {
      clientId: token.slice(4),
      scopes: ['kete:center'],
      expiresAt: new Date(Date.now() + 60_000),
    };
  });
  useCardReader(async (address) => (address.includes('purchases') ? card : null));
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://purchases.example.test/decisions')) {
      told.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    }
    return real(url, init);
  });
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.kofi = await tokenFor('usr_kofi');
  t.kossi = await tokenFor('usr_kossi');
  await admin('/registry/resources', {
    kind: 'app',
    name: 'Achats',
    address: 'https://purchases.example.test',
  });
  // Kofi reports to Kossi.
  const type = (await admin('/structure/unit-types', { key: 'unit', name: 'Unité' }))
    .unitTypeId as string;
  const unit = (
    await admin('/structure/units', { unitTypeId: type, name: 'SAV', startsOn: '2026-01-01' })
  ).unitId as string;
  const chef = (
    await admin('/structure/positions', { unitId: unit, title: 'Chef SAV', startsOn: '2026-01-01' })
  ).positionId as string;
  const tech = (
    await admin('/structure/positions', {
      unitId: unit,
      title: 'Technicien',
      reportsTo: chef,
      startsOn: '2026-01-01',
    })
  ).positionId as string;
  for (const [name, account, position] of [
    ['Kossi', 'usr_kossi', chef],
    ['Kofi', 'usr_kofi', tech],
  ] as const) {
    const personId = (await admin('/structure/people', { name, accountUserId: account }))
      .personId as string;
    await admin('/structure/assignments', {
      personId,
      positionId: position,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.drop();
});

describe('a decision asked by an app', () => {
  it('is refused without a circuit, and for a subject its card does not declare', async () => {
    const none = await call(t.kofi, 'POST', '/v1/apps/prd_kete_purchases/decisions', {
      subject: 'purchase',
      reference: 'po_1',
      title: 'Onduleurs',
      measure: 2_000_000,
    });
    expect(none).toMatchObject({ status: 422, body: { error: 'no_circuit' } });
    const unknown = await call(t.kofi, 'POST', '/v1/apps/prd_kete_purchases/decisions', {
      subject: 'leave',
      reference: 'lv_1',
      title: 'Congé',
    });
    expect(unknown).toMatchObject({ status: 422, body: { error: 'unknown_subject' } });
  });

  it('offers the app’s subject to circuits, in its card’s words', async () => {
    const circuits = (await call(t.admin, 'GET', '/v1/decisions/circuits')).body;
    expect(circuits.subjects).toContain('prd_kete_purchases.purchase');
    expect(circuits.labels).toMatchObject({
      'prd_kete_purchases.purchase': { fr: 'Achats · Achat', en: 'Achats · Purchase' },
    });
    const circuit = await call(t.admin, 'POST', '/v1/decisions/circuits', {
      subject: 'prd_kete_purchases.purchase',
      name: 'Achats au-delà d’un million',
      steps: [{ rule: 'manager', minMeasure: 1_000_000 }],
    });
    expect(circuit.status).toBe(201);
  });

  it('goes to the requester’s manager, who decides; the app is told and reads the outcome', async () => {
    const asked = await call(t.kofi, 'POST', '/v1/apps/prd_kete_purchases/decisions', {
      subject: 'purchase',
      reference: 'po_2',
      title: 'Onduleurs, 2 000 000 FCFA',
      measure: 2_000_000,
      callbackUrl: 'https://purchases.example.test/decisions',
    });
    expect(asked).toMatchObject({ status: 201, body: { status: 'pending' } });
    const requestId = asked.body.requestId as string;
    const inbox = (await call(t.kossi, 'GET', '/v1/decisions/inbox')).body.toDecide as Answer[];
    expect(inbox).toEqual([
      expect.objectContaining({
        requestId,
        subjectLabel: { fr: 'Achats · Achat', en: 'Achats · Purchase' },
      }),
    ]);
    const decided = await call(t.kossi, 'POST', `/v1/decisions/requests/${requestId}/decide`, {
      decision: 'approve',
    });
    expect(decided.body).toMatchObject({ status: 'approved' });
    expect(told).toEqual([
      {
        url: 'https://purchases.example.test/decisions',
        body: { requestId, organizationId: 'org_kya' },
      },
    ]);
    const read = await call(
      'app:cli_purchases',
      'GET',
      `/public/apps/org_kya/decisions/${requestId}`,
    );
    expect(read.body).toMatchObject({ status: 'approved', reference: 'po_2', subject: 'purchase' });
    // Another app reads nothing of it.
    expect(
      (await call('app:cli_other', 'GET', `/public/apps/org_kya/decisions/${requestId}`)).status,
    ).toBe(404);
    // The person who asked reads it too.
    expect(
      (await call(t.kofi, 'GET', `/v1/apps/prd_kete_purchases/decisions/${requestId}`)).body,
    ).toMatchObject({ status: 'approved' });
  });

  it('is approved at once under the threshold', async () => {
    const small = await call(t.kofi, 'POST', '/v1/apps/prd_kete_purchases/decisions', {
      subject: 'purchase',
      reference: 'po_3',
      title: 'Câbles, 50 000 FCFA',
      measure: 50_000,
    });
    expect(small.body).toMatchObject({ status: 'approved' });
  });
});
