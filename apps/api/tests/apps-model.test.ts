import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 091 (kete-core spec 114): the apps on the living model. Kete Finance says what it holds
// with its own token — kept in « Pour moi », relayed, finished when no longer said — and asks the
// organization's policies before a gesture, for a person and for her agent alike.

const ORG = 'org_kyamodel';

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '' };
let key = 0;

const card: IdentityCard = {
  product: 'prd_kete_finance',
  name: 'Kete Finance',
  version: '1.0.0',
  client: 'cli_finance',
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `apps-model-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const invoice = (ref: string, extra: Record<string, unknown> = {}) => ({
  source: { app: 'prd_kete_finance', kind: 'invoice', ref },
  object: { kind: 'party', id: 'pty_garage_be' },
  what: `Encaisser la facture ${ref}`,
  holder: { kind: 'person', id: 'usr_abla' },
  waiting_on: { kind: 'party', id: 'pty_garage_be' },
  state: 'waiting',
  href: `https://finance.example.test/ventes/factures/${ref}`,
  ...extra,
});
const say = (holdings: object[], token = 'app:cli_finance', product = 'prd_kete_finance') =>
  call(token, 'PUT', '/public/apps/holdings', { organization: ORG, product, holdings });

const purchase = (value: number, agent?: string) => ({
  kind: 'purchase.commit',
  object: { kind: 'subject', id: 'prd_kete_finance.purchase' },
  amount: { value, currency: 'XOF' },
  ...(agent ? { agent: { id: agent } } : {}),
});
const gesture = (token: string, body: object) =>
  call(token, 'POST', '/v1/apps/prd_kete_finance/gestures', body);

async function inForce(policy: Record<string, unknown> & { id: string }) {
  expect((await call(t.admin, 'POST', '/v1/policies', policy)).status).toBe(201);
  await call(t.admin, 'POST', `/v1/policies/${policy.id}/status`, { status: 'active' });
}

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
  useCardReader(async (address) => (address.includes('finance') ? card : null));
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.abla = await tokenFor('usr_abla', { name: 'Abla Kpodar', org: ORG });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah', org: ORG });
  const registered = await call(t.admin, 'POST', '/v1/registry/resources', {
    kind: 'app',
    name: 'Kete Finance',
    address: 'https://finance.example.test',
  });
  expect(registered.status).toBe(201);
  const type = (
    await call(t.admin, 'POST', '/v1/structure/unit-types', { key: 'unit', name: 'Unité' })
  ).body.unitTypeId;
  const unit = (
    await call(t.admin, 'POST', '/v1/structure/units', {
      unitTypeId: type,
      name: 'Ventes',
      startsOn: '2026-01-01',
    })
  ).body.unitId as string;
  const position = async (title: string, reportsTo?: string) =>
    (
      await call(t.admin, 'POST', '/v1/structure/positions', {
        unitId: unit,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
  const assign = async (name: string, accountUserId: string, positionId: string) => {
    const personId = (await call(t.admin, 'POST', '/v1/structure/people', { name, accountUserId }))
      .body.personId as string;
    await call(t.admin, 'POST', '/v1/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  };
  const head = await position('Responsable des ventes');
  await assign('Abla Kpodar', 'usr_abla', head);
  await assign('Kossi Amegah', 'usr_kossi', await position('Commercial', head));
});

afterAll(async () => {
  await db?.drop();
});

describe('what an app holds', () => {
  it('is taken only with the app’s own token, from the app the registry holds', async () => {
    expect((await say([invoice('F-1')], t.abla)).status).toBe(401);
    expect((await say([invoice('F-1')], 'app:cli_stranger')).status).toBe(404);
    const wrong = await say([
      { ...invoice('F-1'), source: { app: 'prd_other', kind: 'x', ref: '1' } },
    ]);
    expect(wrong).toMatchObject({ status: 422, body: { error: 'invalid' } });
  });

  it('lands in its holder’s « Pour moi » with its address, and finishes when no longer said', async () => {
    const said = await say([
      invoice('F-1', { due: '2026-10-30' }),
      invoice('F-2'),
      invoice('F-3', { holder: { kind: 'person', id: 'usr_nobody' } }),
    ]);
    expect(said).toMatchObject({
      status: 200,
      body: {
        said: 2,
        finished: 0,
        refused: [{ kind: 'invoice', ref: 'F-3', reason: 'unknown_holder' }],
      },
    });
    const mine = (await call(t.abla, 'GET', '/v1/pour-moi')).body as {
      held: { what: string; href: string; source: { app: string } }[];
      toAnswer: unknown[];
    };
    const fromFinance = [...mine.held, ...(mine.toAnswer as typeof mine.held)].filter(
      (h) => h.source.app === 'prd_kete_finance',
    );
    expect(fromFinance.map((h) => h.href).sort()).toEqual([
      'https://finance.example.test/ventes/factures/F-1',
      'https://finance.example.test/ventes/factures/F-2',
    ]);
    // F-1 was paid: the app no longer says it.
    expect((await say([invoice('F-2')])).body).toMatchObject({ said: 0, finished: 1 });
  });
});

describe('an app’s gesture through the policies', () => {
  it('is unruled while nothing in force speaks of it: the app keeps its own rules', async () => {
    const answer = await gesture(t.kossi, purchase(700_000));
    expect(answer).toMatchObject({
      status: 200,
      body: { verdict: { effect: 'unruled', reason: 'nothing_ruled' } },
    });
  });

  it('is decided by the same policies for the person and for her agent', async () => {
    await inForce({
      id: 'spend.people',
      sentence: 'Une personne engage un achat',
      rule: 'permit (principal is Kete::Person, action == Kete::Action::"purchase.commit", resource);',
      set: 'authority',
    });
    await inForce({
      id: 'spend.over-limit',
      sentence: 'Au-delà de 500 000 F, son responsable approuve',
      rule: `permit (principal, action == Kete::Action::"purchase.commit", resource)
        when { context.amount > 500000 };`,
      set: 'approval',
      approver: 'manager',
    });
    expect((await gesture(t.kossi, purchase(100_000))).body).toMatchObject({
      verdict: { effect: 'allow' },
    });
    expect((await gesture(t.kossi, purchase(700_000))).body).toMatchObject({
      verdict: {
        effect: 'approve',
        policies: [
          { id: 'spend.over-limit', sentence: 'Au-delà de 500 000 F, son responsable approuve' },
        ],
        approvers: [{ approver: 'manager', people: ['usr_abla'] }],
      },
    });
    // His agent: no policy lets an agent commit a purchase — refused, and journaled.
    const byAgent = await gesture(t.kossi, purchase(100_000, 'agt_assistant'));
    expect(byAgent.body).toMatchObject({ verdict: { effect: 'refuse' } });
    const journal = (await call(t.admin, 'GET', '/v1/policies/journal')).body as {
      decisions: { effect: string; gesture: { actor: { kind: string } } }[];
    };
    expect(
      journal.decisions.some((d) => d.effect === 'refuse' && d.gesture.actor.kind === 'agent'),
    ).toBe(true);
  });

  it('lets the app’s rules allow what only forbids and approvals speak of', async () => {
    await inForce({
      id: 'invoice.no-agent',
      sentence: 'Un agent ne facture jamais',
      rule: 'forbid (principal is Kete::Agent, action == Kete::Action::"invoice.issue", resource);',
      set: 'authority',
    });
    const bill = (agent?: string) => ({
      kind: 'invoice.issue',
      object: { kind: 'party', id: 'pty_garage_be' },
      amount: { value: 250_000, currency: 'XOF' },
      ...(agent ? { agent: { id: agent } } : {}),
    });
    expect((await gesture(t.kossi, bill())).body).toMatchObject({
      verdict: { effect: 'allow', policies: [{ id: 'kete.app-rules' }] },
    });
    expect((await gesture(t.kossi, bill('agt_assistant'))).body).toMatchObject({
      verdict: {
        effect: 'refuse',
        policies: [{ id: 'invoice.no-agent', sentence: 'Un agent ne facture jamais' }],
      },
    });
  });

  it('is refused when unknown, on a wrong object, or for an app the registry does not hold', async () => {
    expect(
      (await gesture(t.kossi, { kind: 'card.decide', object: { kind: 'card', id: 'x' } })).body,
    ).toMatchObject({ error: 'unknown_gesture' });
    expect(
      (
        await gesture(t.kossi, {
          ...purchase(1),
          object: { kind: 'document', id: 'doc_1' },
        })
      ).body,
    ).toMatchObject({ error: 'wrong_object' });
    const elsewhere = await call(t.kossi, 'POST', '/v1/apps/prd_unknown/gestures', purchase(1));
    expect(elsewhere.status).toBe(404);
  });
});
