import type { TestSchema } from '@kete/testing';
import { holdingEvents, openHoldings } from '@kete/work';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { relayRound, syncHoldings } from '../src/features/work/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 087: the center's six sources said as holdings, the relay, « Pour moi ». Awa heads the
// service; Kofi reports to her, Esi to Kofi; Esi stands in for Kofi while he is away.

let db: TestSchema;
const api = createApi();
const ORG = 'org_kya';
const t = { admin: '', awa: '', kofi: '', esi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `work-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

interface Shown {
  holdingId: string;
  what: string;
  source: { kind: string; ref: string };
  holder: { id: string };
  href: string;
}
const pourMoi = async (token: string) =>
  (await get(token, '/pour-moi')).body as {
    toAnswer: Shown[];
    held: Shown[];
    information: Shown[];
  };

const today = new Date().toISOString().slice(0, 10);
let requestId = '';
let kofiPerson = '';

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi Dossou' });
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
    return personId;
  };
  const chef = await position('Responsable SAV');
  await assign('Awa Mensah', 'usr_awa', chef);
  const devis = await position('Technicien devis', chef);
  kofiPerson = await assign('Kofi Agbo', 'usr_kofi', devis);
  await assign('Esi Dossou', 'usr_esi', await position('Technicienne', devis));
});

afterAll(async () => {
  await db?.drop();
});

describe('the six sources as holdings', () => {
  it('says a colleague’s request, an app’s task and a meeting’s action in « Pour moi »', async () => {
    const asked = await post(t.awa, '/requests', {
      colleague: 'Kofi Agbo',
      title: 'Chiffrer le devis Garage Bè',
      dueOn: today,
    });
    requestId = (asked.body.request as { requestId: string }).requestId;
    await transaction(ORG, async (tx) => {
      await tx.query(
        `insert into app_tasks (task_id, organization_id, user_id, source, key, title, href)
         values ('tsk_work_1', $1, 'usr_kofi', 'Kete Finance', 'F-1', 'Relancer la facture F-1',
                 'https://finance.kete.test/f-1')`,
        [ORG],
      );
      await tx.query(
        `insert into actions (action_id, organization_id, title, source, responsible_person_id, due_on)
         values ('act_work_1', $1, 'Commander les batteries', 'meeting', $2, $3)`,
        [ORG, kofiPerson, today],
      );
    });
    const kofi = await pourMoi(t.kofi);
    expect(kofi.held.map((h) => h.source.kind).sort()).toEqual(['action', 'app_task', 'request']);
    expect(kofi.held.find((h) => h.source.kind === 'request')).toMatchObject({
      what: 'Chiffrer le devis Garage Bè',
      href: `/demandes/${requestId}`,
    });
    expect((await pourMoi(t.awa)).toAnswer).toEqual([]);
  });

  it('waits on the requester when she is asked back, and closes when the item closes', async () => {
    await post(t.kofi, `/requests/${requestId}/moves`, {
      kind: 'wait',
      question: 'Quelle puissance de batteries ?',
    });
    const awa = await pourMoi(t.awa);
    expect(awa.toAnswer.map((h) => h.what)).toEqual(['Chiffrer le devis Garage Bè']);
    await post(t.awa, `/requests/${requestId}/moves`, { kind: 'answer', text: '200 Ah.' });
    expect((await pourMoi(t.awa)).toAnswer).toEqual([]);

    await transaction(ORG, (tx) =>
      tx.query(`update app_tasks set status = 'done' where task_id = 'tsk_work_1'`),
    );
    const kofi = await pourMoi(t.kofi);
    expect(kofi.held.map((h) => h.source.kind).sort()).toEqual(['action', 'request']);
    // Said again unchanged, nothing is written: the journal has one creation per holding.
    const holdings = await transaction(ORG, async (tx) => {
      await syncHoldings(tx, ORG);
      return openHoldings(tx, { app: 'enterprise' });
    });
    const request = holdings.find((h) => h.source.ref === requestId);
    const events = await transaction(ORG, (tx) => holdingEvents(tx, request?.holdingId ?? ''));
    expect(events.map((e) => e.type)).toEqual(['holding.created', 'holding.waiting']);
  });
});

describe('the relay', () => {
  it('moves Kofi’s holdings to his delegate the day he is away, and she may hand one back', async () => {
    expect(
      (
        await post(t.kofi, '/reception/absence', {
          startsOn: today,
          endsOn: today,
          colleague: 'Esi Dossou',
        })
      ).status,
    ).toBe(201);
    const report = await transaction(ORG, (tx) => relayRound(tx, ORG));
    expect(report.moved).toBe(2);
    const esi = await pourMoi(t.esi);
    expect(esi.held.map((h) => h.source.kind).sort()).toEqual(['action', 'request']);
    expect(esi.held.every((h) => h.holder.id === 'usr_esi')).toBe(true);
    // The sources still name Kofi; the sync keeps Esi while he is away.
    expect((await pourMoi(t.kofi)).held).toEqual([]);
    const told = (await get(t.esi, '/notifications')).body;
    expect(JSON.stringify(told)).toContain('pendant l’absence de Kofi Agbo');

    const action = esi.held.find((h) => h.source.kind === 'action') as Shown;
    const back = await post(t.esi, `/pour-moi/${action.holdingId}/rendre`, {
      reason: 'Kofi l’a déjà commandé hier.',
    });
    expect(back).toMatchObject({ status: 200, body: { holding: { holder: { id: 'usr_kofi' } } } });
    expect(
      (await post(t.esi, `/pour-moi/${action.holdingId}/rendre`, { reason: 'x' })).status,
    ).toBe(409);
    expect(JSON.stringify((await get(t.kofi, '/notifications')).body)).toContain(
      'Kofi l’a déjà commandé hier.',
    );
  });

  it('shows the figures to the administrators only', async () => {
    expect((await get(t.kofi, '/work/figures')).status).toBe(403);
    const figures = await get(t.admin, '/work/figures');
    expect(figures).toMatchObject({ status: 200, body: { open: 2 } });
  });
});

describe('the holdings in Planifier (spec 090)', () => {
  it('shows each holding due on a day as a task of its holder’s week', async () => {
    await post(t.kofi, '/requests', {
      colleague: 'Awa Mensah',
      title: 'Préparer la visite du Garage Bè',
      dueOn: today,
    });
    await pourMoi(t.awa);
    const week = (await get(t.awa, `/time/days?from=${today}&days=1&scope=me`)).body as {
      facts: { kind: string; label: string; source?: string; href?: string }[];
    };
    const tasks = week.facts.filter((f) => f.kind === 'task').map((f) => f.label);
    expect(tasks).toContain('Préparer la visite du Garage Bè');
  });
});
