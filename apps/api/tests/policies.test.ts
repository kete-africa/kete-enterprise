import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 088 (doctrine D-058): one policy engine at the gesture, the same for a person and her
// agent. Abla heads the service; Kossi reports to her; Yao stands in for Abla while she is away.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', yao: '' };
let key = 0;
const project = 'prj_colombe';

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `policies-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

const today = new Date().toISOString().slice(0, 10);
const at = `${today}T10:00:00Z`;
const kossi = { kind: 'person', id: 'usr_kossi' } as const;
// Kete's assistant, acting for Kossi: his agent.
const hisAgent = { kind: 'agent', id: 'agt_assistant', on_behalf_of: 'usr_kossi' } as const;
const purchase = (actor: object, value: number) => ({
  actor,
  kind: 'purchase.commit',
  object: { kind: 'project', id: project },
  amount: { value, currency: 'XOF' },
  at,
});
const message = (actor: object, optedOut: boolean) => ({
  actor,
  kind: 'message.client',
  object: { kind: 'party', id: 'pty_hotel_golfe' },
  channel: 'whatsapp',
  context: { hour: 10, optedOut },
  at,
});

type Decision = {
  decisionId: string;
  effect: string;
  policies: { id: string; version: number; effect: string; reason: string }[];
  trial: { id: string }[];
  approvers: { approver: string; people: string[] }[];
};
const decide = async (token: string, gesture: object) => {
  const answer = await post(token, '/policies/decide', { gesture });
  return { status: answer.status, decision: answer.body.decision as Decision, body: answer.body };
};

/** A policy written on trial, then switched on once observed. */
async function inForce(policy: Record<string, unknown> & { id: string }) {
  const saved = await post(t.admin, '/policies', policy);
  expect(saved).toMatchObject({ status: 201, body: { policy: { status: 'trial', version: 1 } } });
  const on = await post(t.admin, `/policies/${policy.id}/status`, { status: 'active' });
  expect(on.body).toMatchObject({ before: 'trial', policy: { status: 'active', version: 2 } });
}

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.abla = await tokenFor('usr_abla', { name: 'Abla Kpodar' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah' });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const sav = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Service après-vente',
      startsOn: '2026-01-01',
    })
  ).body.unitId as string;
  const position = async (title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId: sav,
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
  };
  const head = await position('Responsable SAV');
  await assign('Abla Kpodar', 'usr_abla', head);
  await assign('Kossi Amegah', 'usr_kossi', await position('Technicien', head));
  await assign('Yao Mensah', 'usr_yao', await position('Adjoint', head));
});

afterAll(async () => {
  await db?.drop();
});

describe('policies written by administrators', () => {
  it('are born on trial, and switched on only once observed', async () => {
    const policy = {
      id: 'spend.people',
      sentence: 'On engage un achat',
      rule: 'permit (principal, action == Kete::Action::"purchase.commit", resource);',
      set: 'authority',
    };
    expect((await post(t.kossi, '/policies', policy)).status).toBe(403);
    expect((await get(t.kossi, '/policies')).status).toBe(403);
    await inForce(policy);
    // Above 150 000 F, the manager of the person — or of the person an agent works for.
    await inForce({
      id: 'spend.over-limit',
      sentence: 'Au-delà de 150 000 F, son responsable approuve',
      rule: `permit (principal, action == Kete::Action::"purchase.commit", resource)
        when { context.amount > 150000 };`,
      set: 'approval',
      approver: 'manager',
    });
    await inForce({
      id: 'clients.speak',
      sentence: 'On écrit aux clients par WhatsApp ou par mail',
      rule: `permit (principal, action == Kete::Action::"message.client", resource)
        when { ["whatsapp", "mail"].contains(context.channel) };`,
      set: 'authority',
    });
    await inForce({
      id: 'consent.stop',
      sentence: 'Un contact qui a écrit STOP ne reçoit plus rien',
      rule: `forbid (principal, action == Kete::Action::"message.client", resource)
        when { context has optedOut && context.optedOut };`,
      set: 'authority',
    });
  });

  it('refuses a rule that does not fit, a reserved id, a switch never observed', async () => {
    const unfit = await post(t.admin, '/policies', {
      id: 'spend.salary',
      sentence: 'Selon le salaire',
      rule: 'permit (principal is Kete::Person, action, resource) when { principal.salary > 3 };',
      set: 'authority',
    });
    expect(unfit).toMatchObject({ status: 422, body: { error: 'invalid_rule' } });
    expect((unfit.body.issues as string[]).length).toBeGreaterThan(0);
    const reserved = await post(t.admin, '/policies', {
      id: 'kete.capabilities',
      sentence: 'Rien',
      rule: 'forbid (principal, action, resource);',
      set: 'authority',
    });
    expect(reserved).toMatchObject({ status: 409, body: { error: 'reserved' } });
    expect(
      (await post(t.admin, '/policies/spend.nothing/status', { status: 'active' })).body,
    ).toMatchObject({ error: 'not_found' });
    expect(
      (await post(t.admin, '/policies/check', { rule: 'permit (principal' })).body,
    ).toMatchObject({ ok: false });
  });

  it('lists Kete’s base and the organization’s policies, with what they did', async () => {
    const listed = (await get(t.admin, '/policies')).body as {
      policies: { id: string; kete: boolean; status: string }[];
      gestures: string[];
    };
    expect(listed.policies.map((p) => p.id)).toEqual([
      'kete.capabilities',
      'kete.requests',
      'clients.speak',
      'consent.stop',
      'spend.over-limit',
      'spend.people',
    ]);
    expect(listed.gestures).toContain('purchase.commit');
  });
});

describe('a gesture asked by a person and by her agent', () => {
  it('goes through the same policy, each with its approver found today', async () => {
    expect((await decide(t.kossi, purchase(kossi, 120000))).decision.effect).toBe('allow');
    const his = await decide(t.kossi, purchase(kossi, 180000));
    const agents = await decide(t.kossi, purchase(hisAgent, 180000));
    for (const { decision } of [his, agents]) {
      expect(decision).toMatchObject({
        effect: 'approve',
        policies: [{ id: 'spend.over-limit', version: 2, effect: 'approve' }],
        approvers: [{ approver: 'manager', people: ['usr_abla'] }],
      });
    }
    const journal = (await get(t.admin, '/policies/journal?policyId=spend.over-limit')).body
      .decisions as { decisionId: string; gesture: { actor: { kind: string } } }[];
    expect(journal.map((d) => d.decisionId).sort()).toEqual(
      [his.decision.decisionId, agents.decision.decisionId].sort(),
    );
    expect(journal.map((d) => d.gesture.actor.kind).sort()).toEqual(['agent', 'person']);
  });

  it('passes an absent manager’s approval to her deputy', async () => {
    expect(
      (
        await post(t.abla, '/reception/absence', {
          startsOn: today,
          endsOn: today,
          colleague: 'Yao Mensah',
        })
      ).status,
    ).toBe(201);
    const { decision } = await decide(t.kossi, purchase(kossi, 180000));
    expect(decision.approvers).toEqual([{ approver: 'manager', people: ['usr_yao'] }]);
  });

  it('refuses with the policy, its version and its sentence — even Abla, even journaled', async () => {
    const abla = { kind: 'person', id: 'usr_abla' };
    expect((await decide(t.abla, message(abla, false))).decision.effect).toBe('allow');
    const stop = await decide(t.abla, message(abla, true));
    expect(stop.decision).toMatchObject({
      effect: 'refuse',
      policies: [
        {
          id: 'consent.stop',
          version: 2,
          effect: 'refuse',
          reason: 'Un contact qui a écrit STOP ne reçoit plus rien',
        },
      ],
    });
    const { rows } = await db.owner.query(
      `select effect from ${db.schema}.kete_policy_decisions where decision_id = $1`,
      [stop.decision.decisionId],
    );
    expect(rows).toEqual([{ effect: 'refuse' }]);
  });

  it('never blocks on trial, and says what the policy would have done', async () => {
    const saved = await post(t.admin, '/policies', {
      id: 'spend.big',
      sentence: 'Aucun achat au-delà de 1 000 000 F',
      rule: `forbid (principal, action == Kete::Action::"purchase.commit", resource)
        when { context.amount > 1000000 };`,
      set: 'authority',
    });
    expect(saved.status).toBe(201);
    const { decision } = await decide(t.kossi, purchase(kossi, 2000000));
    expect(decision.effect).toBe('approve');
    expect(decision.trial).toMatchObject([{ id: 'spend.big' }]);
  });

  it('refuses a gesture the center does not know, and another’s gesture', async () => {
    const unknown = await decide(t.kossi, {
      actor: kossi,
      kind: 'treasury.pay',
      object: { kind: 'invoice', id: 'F-1' },
      at,
    });
    expect(unknown).toMatchObject({ status: 422, body: { error: 'unknown_gesture' } });
    const wrong = await decide(t.kossi, {
      ...purchase(kossi, 1),
      object: { kind: 'party', id: 'x' },
    });
    expect(wrong).toMatchObject({ status: 422, body: { error: 'wrong_object' } });
    const others = await decide(t.yao, purchase(kossi, 1));
    expect(others).toMatchObject({ status: 403, body: { error: 'not_yours' } });
  });
});

describe('what bounds the agents (spec 090)', () => {
  it('is read by every member, in sentences, without the rules', async () => {
    await post(t.admin, '/policies', {
      id: 'clients.hours',
      sentence: 'Un agent n’écrit pas aux clients avant 8 h ni après 19 h',
      rule: `forbid (principal is Kete::Agent, action == Kete::Action::"message.client", resource)
        when { context.hour < 8 || context.hour >= 19 };`,
      set: 'authority',
    });
    const read = (await get(t.kossi, '/policies/agents')).body.policies as {
      id: string;
      status: string;
      rule?: string;
    }[];
    expect(read).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'clients.hours', status: 'trial' })]),
    );
    expect(read.some((p) => p.id === 'consent.stop')).toBe(false);
    expect(read.every((p) => p.rule === undefined)).toBe(true);
  });
});

describe('circuits and compliance', () => {
  it('writes a circuit as its approval policy', async () => {
    const circuit = await post(t.admin, '/decisions/circuits', {
      subject: 'registry.promotion',
      name: 'Promotion des ressources',
      steps: [{ rule: 'manager' }],
    });
    expect(circuit.status).toBe(201);
    const { body } = await get(t.admin, '/policies/circuit.registry.promotion');
    expect(body.versions).toMatchObject([
      {
        set: 'approval',
        approver: 'circuit',
        status: 'active',
        sentence: 'Le circuit « Promotion des ressources » décide',
      },
    ]);
  });

  it('proves the policies hold, and names one left on trial too long', async () => {
    const control = await post(t.admin, '/compliance/controls', {
      name: 'Les politiques sont tenues',
      description: 'Lu dans le journal des politiques.',
      frequencyDays: 30,
      method: 'automatic',
      check: 'policies.in_force',
    });
    const controlId = String(control.body.controlId);
    expect((await post(t.admin, `/compliance/controls/${controlId}/collect`)).body).toMatchObject({
      outcome: 'pass',
    });
    await db.owner.query(
      `update ${db.schema}.kete_policies set created_at = now() - interval '40 days'
        where policy_id = 'spend.big'`,
    );
    expect((await post(t.admin, `/compliance/controls/${controlId}/collect`)).body).toMatchObject({
      outcome: 'fail',
      details: { count: 1, items: ['Aucun achat au-delà de 1 000 000 F'] },
    });
  });
});
