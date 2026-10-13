import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 075: a circuit sends a request back to who asked — she corrects it and sends it again,
// without a new request; a step may only inform its people; a step may be decided by the lead of
// the request's project.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '', kossi: '', awa: '', esi: '', dir: '' };
const ids = {} as Record<'project' | 'esi' | 'returned', string>;
let key = 0;
const told: string[] = [];

const card: IdentityCard = {
  product: 'prd_kete_gestion',
  name: 'Gestion',
  version: '1.0.0',
  client: 'cli_gestion',
  subjects: [
    {
      name: 'purchase',
      label: { fr: 'Achat', en: 'Purchase' },
      measure: { fr: 'Montant (F CFA)', en: 'Amount (F CFA)' },
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
      'idempotency-key': `circuits-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) =>
  call(token, 'POST', `/v1${path}`, body);
const get = (token: string, path: string) => call(token, 'GET', `/v1${path}`);

/** Kofi asks a purchase through the app, on the project or not. */
const ask = (reference: string, measure: number, project = true) =>
  post(t.kofi, '/apps/prd_kete_gestion/decisions', {
    subject: 'purchase',
    reference,
    title: `Achat ${reference}`,
    measure,
    callbackUrl: 'https://gestion.example.test/decisions',
    ...(project ? { projectId: ids.project } : {}),
  });
const decide = (token: string, requestId: string, decision: string, reason?: string) =>
  post(token, `/decisions/requests/${requestId}/decide`, {
    decision,
    ...(reason ? { reason } : {}),
  });
type Inbox = { requestId: string; status: string; currentStep: number | null }[];
const waitingFor = async (token: string) =>
  ((await get(token, '/decisions/inbox')).body.toDecide as Inbox).map((r) => r.requestId);
const stepsOf = async (token: string, requestId: string) =>
  (
    (await get(token, '/decisions/inbox')).body.mine as (Inbox[number] & {
      steps: { status: string; decidedBy: string | null }[];
      returned: { by: string; reason: string } | null;
    })[]
  ).find((request) => request.requestId === requestId);
const asApp = (requestId: string) =>
  call('app:cli_gestion', 'GET', `/public/apps/org_kya/decisions/${requestId}`);

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
  useCardReader(async (address) => (address.includes('gestion') ? card : null));
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://gestion.example.test/decisions')) {
      told.push((JSON.parse(String(init?.body)) as { requestId: string }).requestId);
      return new Response(null, { status: 204 });
    }
    return real(url, init);
  });
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  for (const who of ['kofi', 'kossi', 'awa', 'esi', 'dir'] as const) {
    t[who] = await tokenFor(`usr_${who}`, { name: who });
  }
  await post(t.admin, '/registry/resources', {
    kind: 'app',
    name: 'Gestion',
    address: 'https://gestion.example.test',
  });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'SAV',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  const position = async (title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
  const assign = async (name: string, accountUserId: string, positionId: string) => {
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId as string;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    return personId;
  };
  // Kofi reports to Kossi; Awa leads the project; the director decides large amounts; Esi keeps
  // the accounts and is told.
  const direction = await position('Direction');
  const chef = await position('Chef SAV');
  await assign('Directrice', 'usr_dir', direction);
  await assign('Kossi', 'usr_kossi', chef);
  await assign('Kofi', 'usr_kofi', await position('Technicien', chef));
  const lead = await position('Cheffe de projet');
  await assign('Awa', 'usr_awa', lead);
  ids.esi = await assign('Esi', 'usr_esi', await position('Comptable'));
  const roleId = (
    await post(t.admin, '/rights/roles', { name: 'Projets', permissions: ['projects:manage'] })
  ).body.roleId;
  await post(t.admin, '/rights/grants', { roleId, positionId: lead, startsOn: '2026-01-01' });
  ids.project = (
    (await post(t.awa, '/projects', { name: 'Chantier Garage Bè' })).body.project as {
      projectId: string;
    }
  ).projectId;
  const circuit = await post(t.admin, '/decisions/circuits', {
    subject: 'prd_kete_gestion.purchase',
    name: 'Achats',
    steps: [
      { rule: 'manager' },
      { rule: 'project_lead' },
      { rule: 'position', positionId: direction, minMeasure: 500_000 },
      { rule: 'person', personId: ids.esi, inform: true },
    ],
  });
  expect(circuit.status).toBe(201);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.drop();
});

describe('a circuit, completed', () => {
  it('passes by the lead of the request’s project, and tells who is only informed', async () => {
    const asked = await ask('po_1', 190_000);
    expect(asked).toMatchObject({ status: 201, body: { status: 'pending' } });
    const requestId = String(asked.body.requestId);
    // Her manager first; the project's lead does not decide yet.
    expect(await waitingFor(t.kossi)).toEqual([requestId]);
    expect(await waitingFor(t.awa)).toEqual([]);
    await decide(t.kossi, requestId, 'approve');
    // Then the lead of the project the request belongs to — nobody else.
    expect(await waitingFor(t.awa)).toEqual([requestId]);
    expect(await waitingFor(t.kossi)).toEqual([]);
    expect((await decide(t.kossi, requestId, 'approve')).status).toBe(403);
    const last = await decide(t.awa, requestId, 'approve');
    // Under 500 000 the direction's step is skipped; the accounts are told and decide nothing.
    expect(last.body).toMatchObject({ status: 'approved' });
    expect((await stepsOf(t.kofi, requestId))?.steps.map((step) => step.status)).toEqual([
      'approved',
      'approved',
      'skipped',
      'informed',
    ]);
    expect(await waitingFor(t.esi)).toEqual([]);
    const news = (await get(t.esi, '/notifications')).body.notifications as { title: string }[];
    expect(news[0]?.title).toBe('Pour information : Achat po_1');
    expect(told).toContain(requestId);
  });

  it('sends a request back to who asked, with a reason — and nobody decides it meanwhile', async () => {
    const requestId = String((await ask('po_2', 600_000)).body.requestId);
    ids.returned = requestId;
    expect((await decide(t.kossi, requestId, 'return')).status).toBe(422);
    const back = await decide(t.kossi, requestId, 'return', 'Joindre le devis du fournisseur.');
    expect(back.body).toMatchObject({ status: 'returned' });
    expect(await stepsOf(t.kofi, requestId)).toMatchObject({
      status: 'returned',
      returned: { by: 'usr_kossi', reason: 'Joindre le devis du fournisseur.' },
    });
    // She is told what to correct; the app reads why; nobody may decide it.
    const news = (await get(t.kofi, '/notifications')).body.notifications as { title: string }[];
    expect(news[0]?.title).toContain('À corriger : Achat po_2 — Joindre le devis');
    expect((await asApp(requestId)).body).toMatchObject({
      status: 'returned',
      reason: 'Joindre le devis du fournisseur.',
      decidedBy: 'usr_kossi',
    });
    expect(told).toContain(requestId);
    expect(await waitingFor(t.kossi)).toEqual([]);
    expect((await decide(t.kossi, requestId, 'approve')).status).toBe(409);
    // Only who asked sends it again.
    expect((await post(t.awa, `/decisions/requests/${requestId}/resubmit`)).status).toBe(403);
  });

  it('is corrected and sent again through the app: the same request, not a new one', async () => {
    // Asked again with the same reference, corrected: a lower amount.
    const again = await ask('po_2', 450_000);
    expect(again).toMatchObject({ status: 201, body: { status: 'pending' } });
    const sameId = String(again.body.requestId);
    expect(sameId).toBe(ids.returned);
    expect(await waitingFor(t.kossi)).toEqual([sameId]);
    await decide(t.kossi, sameId, 'approve');
    const done = await decide(t.awa, sameId, 'approve');
    // 450 000 no longer reaches the direction's threshold.
    expect(done.body).toMatchObject({ status: 'approved' });
    expect((await stepsOf(t.kofi, sameId))?.steps.map((step) => step.status)).toEqual([
      'approved',
      'approved',
      'skipped',
      'informed',
    ]);
    // Asked a third time, once decided: it is a duplicate.
    expect((await ask('po_2', 450_000)).status).toBe(409);
  });

  it('goes on where it was sent back when the amount is the same', async () => {
    const requestId = String((await ask('po_3', 300_000)).body.requestId);
    await decide(t.kossi, requestId, 'approve');
    await decide(t.awa, requestId, 'return', 'Préciser le poste du budget.');
    const again = await post(t.kofi, `/decisions/requests/${requestId}/resubmit`, {
      title: 'Achat po_3 — poste Matériel',
    });
    expect(again.body).toMatchObject({ status: 'pending', step: 2 });
    // Her manager's approval stays: the project's lead decides again, alone.
    expect(await waitingFor(t.kossi)).toEqual([]);
    expect(await waitingFor(t.awa)).toEqual([requestId]);
    expect((await stepsOf(t.kofi, requestId))?.steps[0]).toMatchObject({
      status: 'approved',
      decidedBy: 'usr_kossi',
    });
    expect((await post(t.kofi, `/decisions/requests/${requestId}/resubmit`)).status).toBe(409);
  });

  it('starts again when the amount is higher: nobody approved that amount', async () => {
    const requestId = String((await ask('po_4', 300_000)).body.requestId);
    await decide(t.kossi, requestId, 'approve');
    await decide(t.awa, requestId, 'return', 'Il en faut huit, pas quatre.');
    const again = await post(t.kofi, `/decisions/requests/${requestId}/resubmit`, {
      measure: 700_000,
    });
    expect(again.body).toMatchObject({ status: 'pending', step: 1 });
    expect(await waitingFor(t.kossi)).toEqual([requestId]);
    await decide(t.kossi, requestId, 'approve');
    await decide(t.awa, requestId, 'approve');
    // 700 000 now reaches the direction.
    expect(await waitingFor(t.dir)).toEqual([requestId]);
    expect((await decide(t.dir, requestId, 'approve')).body).toMatchObject({ status: 'approved' });
  });

  it('goes to the administrators when the request has no project to find a lead in', async () => {
    const requestId = String((await ask('po_5', 100_000, false)).body.requestId);
    await decide(t.kossi, requestId, 'approve');
    expect(await waitingFor(t.awa)).not.toContain(requestId);
    expect(await waitingFor(t.admin)).toContain(requestId);
    expect((await decide(t.admin, requestId, 'approve')).body).toMatchObject({
      status: 'approved',
    });
  });
});
