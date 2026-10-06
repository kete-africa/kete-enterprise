import { newEventId } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import {
  checkDueWatches,
  runQueuedRoutines,
  useRoutineModel,
} from '../src/features/routines/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 051: routines — at a set time, when an app signals, on watch over a figure — each
// understood from a sentence, run with its person's rights, every run kept.

const ORG = 'org_kyademo';
let db: TestSchema;
const api = createApi();
const t = { ama: '', kofi: '', other: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `routines-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const answering = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });
const card: IdentityCard = {
  product: 'prd_kete_helpdesk',
  name: 'Support',
  version: '1.0.0',
  client: 'cli_helpdesk',
  emits: [
    { type: 'ticket.critical', description: 'Un ticket critique', classification: 'internal' },
    { type: 'pay.changed', description: 'Une paie a changé', classification: 'secret' },
  ],
};
const event = (type: string) => ({
  id: newEventId(),
  type,
  specversion: '1',
  product: 'prd_kete_helpdesk',
  organization: ORG,
  occurred_at: new Date().toISOString(),
  data: { ticketId: 'tkt_1058', site: 'Tsévié' },
});
async function deliver(events: object[]) {
  const response = await api.request('/public/apps/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer app:cli_helpdesk' },
    body: JSON.stringify({ events }),
  });
  return (await response.json()) as Answer;
}
const understanding = (value: object) =>
  answering(
    JSON.stringify({
      instruction: null,
      cadence: null,
      weekday: null,
      time: null,
      resourceId: null,
      eventType: null,
      dashboardId: null,
      cardId: null,
      direction: null,
      line: null,
      ...value,
    }),
  );
type Overview = {
  triggers: { triggerId: string }[];
  watches: { watchId: string }[];
  runs: { family: string; status: string; cause: string; tried: boolean; summary: string | null }[];
};
const overview = async (token: string) =>
  (await call(token, 'GET', '/routines')).body as unknown as Overview;

beforeAll(async () => {
  db = await startApi();
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  useAppVerifier(async (token) => {
    if (!token.startsWith('app:')) throw new Error('not an app');
    return {
      clientId: token.slice(4),
      scopes: ['kete:center'],
      expiresAt: new Date(Date.now() + 60_000),
    };
  });
  useCardReader(async (address) => (address.includes('helpdesk') ? card : null));
  t.ama = await tokenFor('usr_ama', { role: 'admin', org: ORG, name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { org: ORG, name: 'Kofi' });
  t.other = await tokenFor('usr_ama', { role: 'admin', org: 'org_other', name: 'Ama' });
  const registered = await call(t.ama, 'POST', '/registry/resources', {
    kind: 'app',
    name: 'Support',
    address: 'https://helpdesk.example.test',
  });
  expect(registered.status).toBe(201);
  ids.app = String(registered.body.resourceId);
  for (const module of ['datasets', 'dashboards']) {
    await call(t.ama, 'POST', '/organization/modules', { module, enabled: true });
  }
  const dataset = await call(t.ama, 'POST', '/datasets', {
    name: 'Tickets SAV',
    fileName: 'tickets.csv',
    contentType: 'text/csv',
    data: Buffer.from('Agence;Délai\nLomé;2\nKara;5\nLomé;4\n', 'utf8').toString('base64'),
  });
  ids.dataset = (dataset.body.dataset as { datasetId: string }).datasetId;
  const board = await call(t.ama, 'POST', '/dashboards', {
    name: 'SAV',
    widgets: [
      {
        title: 'Délai moyen',
        source: { kind: 'dataset', id: ids.dataset },
        query: { measures: [{ fn: 'avg', column: 'Délai' }] },
        view: 'number',
      },
    ],
  });
  const dashboard = board.body.dashboard as { dashboardId: string; widgets: { id: string }[] };
  ids.dashboard = dashboard.dashboardId;
  ids.card = dashboard.widgets[0]?.id ?? '';
});

afterAll(async () => {
  useModel(undefined);
  useRoutineModel(undefined);
  await db?.drop();
});

describe('a routine', () => {
  it('is understood from a sentence, as each family, and nothing is kept before she activates it', async () => {
    useRoutineModel(
      understanding({
        family: 'time',
        title: 'Tickets de la semaine',
        instruction: 'Résume les tickets de la semaine.',
        cadence: 'weekly',
        weekday: 5,
        time: '16:00',
        plan: ['Chaque vendredi à 16 h', 'L’assistant lit Support avec vos droits'],
      }),
    );
    const time = await call(t.ama, 'POST', '/routines/understand', {
      sentence: 'Chaque vendredi à 16 h, résume les tickets de la semaine',
    });
    expect(time.body.proposal).toMatchObject({ family: 'time', cadence: 'weekly', weekday: 5 });
    useRoutineModel(
      understanding({
        family: 'event',
        title: 'Ticket critique',
        instruction: 'Dis-moi quel technicien est libre.',
        resourceId: ids.app,
        eventType: 'ticket.critical',
        plan: ['Quand Support signale un ticket critique'],
      }),
    );
    const onEvent = await call(t.ama, 'POST', '/routines/understand', {
      sentence: 'Quand un ticket critique arrive, dis-moi quel technicien est libre',
    });
    expect(onEvent.body.proposal).toMatchObject({
      family: 'event',
      app: 'Support',
      eventType: 'ticket.critical',
    });
    useRoutineModel(
      understanding({
        family: 'watch',
        title: 'Délai',
        dashboardId: ids.dashboard,
        cardId: ids.card,
        direction: 'above',
        line: 3,
        plan: ['Chaque heure, je lis le délai moyen'],
      }),
    );
    const watch = await call(t.ama, 'POST', '/routines/understand', {
      sentence: 'Préviens-moi quand le délai moyen dépasse 3 jours',
    });
    expect(watch.body.proposal).toMatchObject({ family: 'watch', figure: 'SAV · Délai moyen' });
    // A type no app of hers declares is not understood.
    useRoutineModel(
      understanding({
        family: 'event',
        title: 'X',
        instruction: 'x',
        resourceId: ids.app,
        eventType: 'pay.changed',
        plan: ['x'],
      }),
    );
    expect(
      (await call(t.ama, 'POST', '/routines/understand', { sentence: 'Quand une paie change' }))
        .status,
    ).toBe(422);
    const mine = await overview(t.ama);
    expect(mine.triggers).toEqual([]);
    expect(mine.watches).toEqual([]);
  });

  it('runs when an app signals, for whoever hears the app — never on a secret event', async () => {
    const created = await call(t.ama, 'POST', '/routines/triggers', {
      title: 'Ticket critique',
      prompt: 'Dis-moi quel technicien est libre.',
      resourceId: ids.app,
      eventType: 'ticket.critical',
    });
    expect(created.status).toBe(201);
    ids.trigger = (created.body.trigger as { triggerId: string }).triggerId;
    expect(
      (
        await call(t.ama, 'POST', '/routines/triggers', {
          title: 'Paie',
          prompt: 'x',
          resourceId: ids.app,
          eventType: 'pay.changed',
        })
      ).status,
    ).toBe(422);
    await deliver([event('ticket.critical'), event('pay.changed')]);
    const queued = (await overview(t.ama)).runs;
    expect(queued).toEqual([expect.objectContaining({ family: 'event', status: 'queued' })]);
    useModel(answering('Afi est libre cet après-midi.'));
    expect(await runQueuedRoutines()).toBe(1);
    expect(await runQueuedRoutines()).toBe(0);
    const [run] = (await overview(t.ama)).runs;
    expect(run).toMatchObject({ status: 'done', summary: 'Afi est libre cet après-midi.' });
    const tasks = (await call(t.ama, 'GET', '/workspace/tasks')).body.tasks as { title: string }[];
    expect(tasks.map((x) => x.title)).toContain('Ticket critique');
  });

  it('is tried once, at once, and kept as tried', async () => {
    const tried = await call(t.ama, 'POST', `/routines/triggers/${ids.trigger}/try`);
    expect(tried).toMatchObject({ status: 201, body: { status: 'done' } });
    expect((await overview(t.ama)).runs[0]).toMatchObject({ tried: true, cause: 'essai' });
  });

  it('on watch, tells her once when its figure crosses the line, and again after it came back', async () => {
    const created = await call(t.ama, 'POST', '/routines/watches', {
      title: 'Délai trop long',
      dashboardId: ids.dashboard,
      cardId: ids.card,
      direction: 'above',
      line: 3,
    });
    expect(created.status).toBe(201);
    ids.watch = (created.body.watch as { watchId: string }).watchId;
    const told = () =>
      overview(t.ama).then((o) =>
        o.runs.filter((r) => r.family === 'watch' && r.status === 'told'),
      );
    expect(await checkDueWatches()).toBe(1);
    expect((await told()).length).toBe(1);
    // Still over the line an hour later: no second word.
    await db.owner.query('update routine_watches set last_checked_at = null');
    await checkDueWatches();
    expect((await told()).length).toBe(1);
    // Back under the line, then over again: told again.
    await db.owner.query('update routine_watches set line = 10, last_checked_at = null');
    await checkDueWatches();
    await db.owner.query('update routine_watches set line = 3, last_checked_at = null');
    await checkDueWatches();
    expect((await told()).length).toBe(2);
    const notes = (await call(t.ama, 'GET', '/notifications')).body;
    expect(JSON.stringify(notes)).toContain('Délai moyen');
  });

  it('is hers alone: a colleague and another organization see nothing of it', async () => {
    const kofi = await overview(t.kofi);
    expect(kofi.triggers).toEqual([]);
    expect(kofi.watches).toEqual([]);
    expect(kofi.runs).toEqual([]);
    expect((await call(t.kofi, 'POST', `/routines/triggers/${ids.trigger}/try`)).status).toBe(404);
    expect((await call(t.kofi, 'POST', `/routines/watches/${ids.watch}/remove`)).status).toBe(404);
    expect((await overview(t.other)).runs).toEqual([]);
  });
});
