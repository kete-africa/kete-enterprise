import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 032: a simple collection — a few fields — answered in the space or by a link without an
// account; each answer through the circuit an administrator defines for it, from a threshold; the
// answers read as data by the same query as a team's tables.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string | null, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      'idempotency-key': `forms-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const v1 = (token: string, method: 'GET' | 'POST', path: string, body?: object) =>
  call(token, method, `/v1${path}`, body);

const expenses = {
  name: 'Note de frais',
  description: 'Une dépense engagée pour l’entreprise',
  fields: [
    { key: 'object', label: 'Objet', type: 'text', required: true },
    { key: 'amount', label: 'Montant (FCFA)', type: 'number', required: true },
    { key: 'spent_on', label: 'Date', type: 'date', required: true },
    { key: 'kind', label: 'Nature', type: 'choice', options: ['Transport', 'Repas', 'Autre'] },
    { key: 'receipt', label: 'Justificatif joint', type: 'yes_no' },
  ],
  measureField: 'amount',
};

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
});

afterAll(async () => {
  await db?.drop();
});

describe('a form', () => {
  let formId = '';
  let subject = '';

  it('answers only when its module is on, and checks its fields', async () => {
    expect((await v1(t.ama, 'GET', '/forms')).body).toMatchObject({ error: 'module_disabled' });
    await v1(t.admin, 'POST', '/organization/modules', { module: 'forms', enabled: true });
    expect(
      (
        await v1(t.ama, 'POST', '/forms', {
          ...expenses,
          measureField: 'object',
        })
      ).status,
    ).toBe(422);
    const created = await v1(t.ama, 'POST', '/forms', expenses);
    expect(created).toMatchObject({ status: 201, body: { collection: { name: 'Note de frais' } } });
    const collection = created.body.collection as { collectionId: string; subject: string };
    formId = collection.collectionId;
    subject = collection.subject;
    expect(subject).toMatch(/^forms\.c[a-z0-9]+$/);
    expect((await v1(t.kofi, 'GET', '/forms')).body).toMatchObject({
      mine: [],
      toAnswer: [{ collectionId: formId }],
    });
  });

  it('is answered in the space, each value checked, received at once without a circuit', async () => {
    const wrong = await v1(t.kofi, 'POST', `/forms/${formId}/submit`, {
      values: { object: 'Taxi', amount: 'beaucoup', spent_on: '12/10/2026', kind: 'Avion' },
    });
    expect(wrong).toMatchObject({ status: 422, body: { error: 'invalid_answer' } });
    const answered = await v1(t.kofi, 'POST', `/forms/${formId}/submit`, {
      values: {
        object: 'Taxi aéroport',
        amount: 8000,
        spent_on: '2026-10-12',
        kind: 'Transport',
        receipt: true,
      },
    });
    expect(answered).toMatchObject({ status: 201, body: { requested: false } });
    // Kofi sees his own answer; Ama, who runs the form, sees them all.
    expect(
      ((await v1(t.kofi, 'GET', `/forms/${formId}`)).body.submissions as unknown[]).length,
    ).toBe(1);
    expect((await v1(t.ama, 'GET', `/forms/${formId}`)).body).toMatchObject({
      manage: true,
      submissions: [{ status: 'received', submitterName: 'Kofi Mensah' }],
    });
  });

  it('goes through its circuit from a threshold, decided in the Inbox', async () => {
    const circuit = await v1(t.admin, 'POST', '/decisions/circuits', {
      subject,
      name: 'Notes de frais',
      steps: [{ rule: 'manager', minMeasure: 50000 }],
    });
    expect(circuit.status).toBe(201);
    const small = await v1(t.kofi, 'POST', `/forms/${formId}/submit`, {
      values: { object: 'Repas client', amount: 15000, spent_on: '2026-10-13', kind: 'Repas' },
    });
    expect(small.body).toMatchObject({ requested: true });
    const large = await v1(t.kofi, 'POST', `/forms/${formId}/submit`, {
      values: { object: 'Hôtel Kara', amount: 90000, spent_on: '2026-10-14', kind: 'Autre' },
    });
    const statuses = async () =>
      (
        (await v1(t.ama, 'GET', `/forms/${formId}`)).body.submissions as {
          submissionId: string;
          status: string;
          values: { object: string };
        }[]
      ).map((s) => [s.values.object, s.status]);
    expect(await statuses()).toEqual([
      ['Hôtel Kara', 'pending'],
      ['Repas client', 'approved'],
      ['Taxi aéroport', 'received'],
    ]);
    expect(large.body).toMatchObject({ requested: true });
    const inbox = (await v1(t.admin, 'GET', '/decisions/inbox')).body.toDecide as {
      requestId: string;
      title: string;
    }[];
    const request = inbox.find((r) => r.title.startsWith('Note de frais'));
    expect(request?.title).toBe('Note de frais — Kofi Mensah');
    await v1(t.admin, 'POST', `/decisions/requests/${request?.requestId}/decide`, {
      decision: 'approve',
    });
    expect((await statuses())[0]).toEqual(['Hôtel Kara', 'approved']);
  });

  it('is answered by its link without an account, until it is closed', async () => {
    expect((await v1(t.kofi, 'POST', `/forms/${formId}/link`)).status).toBe(403);
    const link = await v1(t.ama, 'POST', `/forms/${formId}/link`);
    const token = String(link.body.url).split('/lien/')[1] ?? '';
    expect((await call(null, 'GET', `/public/forms/${token}`)).body).toMatchObject({
      form: { name: 'Note de frais', fields: expect.any(Array) },
    });
    const outside = await call(null, 'POST', `/public/forms/${token}/submit`, {
      name: 'Prestataire Efua',
      values: { object: 'Carburant', amount: 20000, spent_on: '2026-10-15' },
    });
    expect(outside).toMatchObject({ status: 201, body: { submitted: true } });
    await v1(t.ama, 'POST', `/forms/${formId}`, { open: false });
    expect((await call(null, 'GET', `/public/forms/${token}`)).status).toBe(404);
    expect(
      (
        await v1(t.kofi, 'POST', `/forms/${formId}/submit`, {
          values: { object: 'X', amount: 1, spent_on: '2026-10-16' },
        })
      ).body,
    ).toMatchObject({ error: 'closed' });
  });

  it('reads its answers as data, for who runs it', async () => {
    expect((await v1(t.kofi, 'POST', `/forms/${formId}/query`, {})).status).toBe(403);
    const byKind = await v1(t.ama, 'POST', `/forms/${formId}/query`, {
      groupBy: ['kind'],
      measures: [{ fn: 'sum', column: 'amount' }, { fn: 'count' }],
    });
    expect(byKind.body.rows).toEqual([
      { kind: 'Autre', 'sum(amount)': 90000, count: 1 },
      { kind: null, 'sum(amount)': 20000, count: 1 },
      { kind: 'Repas', 'sum(amount)': 15000, count: 1 },
      { kind: 'Transport', 'sum(amount)': 8000, count: 1 },
    ]);
    const receipts = await v1(t.ama, 'POST', `/forms/${formId}/query`, {
      measures: [{ fn: 'sum', column: 'receipt' }],
    });
    expect(receipts.body.rows).toEqual([{ 'sum(receipt)': 1 }]);
  });
});
