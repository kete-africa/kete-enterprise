import { newEventId } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { dispatchEvents } from '../src/features/events/index.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 101 (kete-core spec 143, ADR 0017; doctrine D-062, R11): one event path. An object of the
// index that is born or changes state says so; an app's event names its object; each lands once in
// one log. Its thread hears the app's facts, the agents that follow it get a task in that thread,
// each delivery is kept — a replay acts once — and what fails is retried, then shown.

const ORG = 'org_events';

let db: TestSchema;
const api = createApi();
const t = { admin: '', yao: '', essi: '' };
let key = 0;
const ids = {} as Record<'asset' | 'agent' | 'subscription' | 'thread', string>;

const card: IdentityCard = {
  product: 'prd_support',
  name: 'Support',
  version: '1.0.0',
  client: 'cli_support',
  emits: [
    { type: 'ticket.solved', description: 'Ticket résolu', classification: 'internal' },
    { type: 'pay.changed', description: 'Une paie a changé', classification: 'secret' },
  ],
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `events-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Answer };
  } catch {
    return { status: response.status, body: { text } as Answer };
  }
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

async function appEvent(type: string, object?: { kind: string; id: string }) {
  const id = newEventId();
  const response = await api.request('/public/apps/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer app:cli_support' },
    body: JSON.stringify({
      events: [
        {
          id,
          type,
          specversion: '1',
          product: 'prd_support',
          organization: ORG,
          occurred_at: new Date().toISOString(),
          data: { ticketId: 'tkt_1' },
          ...(object ? { object } : {}),
        },
      ],
    }),
  });
  expect(response.status).toBe(200);
  return id;
}

const owner = async <T>(sql: string, params: unknown[] = []) =>
  (await db.owner.query(sql.replaceAll('{s}', db.schema), params)).rows as T[];
const tasksOf = (agentId: string) =>
  owner<{ instruction: string; thread_id: string }>(
    `select t.instruction, x.thread_id from {s}.agent_tasks t
       join {s}.agent_task_threads x using (task_id) where t.agent_id = $1 order by t.created_at`,
    [agentId],
  );

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
  useCardReader(async (address) => (address.includes('support') ? card : null));
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah', org: ORG });
  t.essi = await tokenFor('usr_essi', { name: 'Essi Lawson', org: ORG });
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  expect(
    (
      await post(t.admin, '/registry/resources', {
        kind: 'app',
        name: 'Support',
        address: 'https://support.example.test',
      })
    ).status,
  ).toBe(201);
  const asset = await post(t.admin, '/assets', {
    name: 'Mini-centrale · École de Tsévié',
    holderUserId: 'usr_yao',
  });
  expect(asset.status).toBe(201);
  ids.asset = (asset.body.asset as { assetId: string }).assetId;
  ids.thread = String((await get(t.admin, `/assets/${ids.asset}`)).body.threadId);
  const agent = await post(t.admin, '/agents', {
    name: 'Agent Parc',
    kind: 'personal',
    mission: 'Suivre les équipements en alerte.',
    permissions: ['objects:read'],
    autonomyMax: 1,
    draftBudget: 5,
    watches: ['decisions'],
  });
  expect(agent.status).toBe(201);
  ids.agent = String(agent.body.agentId);
});

afterAll(async () => {
  await db?.drop();
});

describe('an object that is born or changes state says so (R11)', () => {
  it('lands once in the log, read by who may read the object', async () => {
    expect((await post(t.yao, `/assets/${ids.asset}`, { state: 'maintenance' })).status).toBe(200);
    const history = await get(t.yao, `/objects/asset/${ids.asset}/events`);
    expect(history.status).toBe(200);
    const events = history.body.events as { type: string; data: Record<string, unknown> }[];
    expect(events.map((e) => e.type)).toEqual(['object.state_changed', 'object.created']);
    expect(events[0]?.data).toEqual({ from: 'in_service', to: 'maintenance' });
    // Who may not read the object learns nothing of it, not even that it exists.
    expect((await get(t.essi, `/objects/asset/${ids.asset}/events`)).status).toBe(404);
  });
});

describe('an agent follows events (FR-004, FR-005)', () => {
  it('is directed by its person or a manager of agents; a kind and a state must exist', async () => {
    const follow = (token: string, body: object) =>
      post(token, '/events/subscriptions', {
        consumer: 'agent',
        consumerId: ids.agent,
        type: 'object.state_changed',
        ...body,
      });
    expect((await follow(t.yao, { objectKind: 'asset' })).status).toBe(403);
    expect((await follow(t.admin, { objectKind: 'asset', state: 'boiling' })).status).toBe(422);
    expect((await follow(t.admin, { objectKind: 'spaceship' })).status).toBe(422);
    const made = await follow(t.admin, { objectKind: 'asset', state: 'alert' });
    expect(made.status).toBe(201);
    ids.subscription = (made.body.subscription as { subscriptionId: string }).subscriptionId;
    const listed = await get(t.admin, `/events/subscriptions?agent=${ids.agent}`);
    expect((listed.body.subscriptions as unknown[]).length).toBe(1);
  });

  it('gets one task in the object’s thread when the object reaches the state; a replay acts once', async () => {
    await dispatchEvents(ORG);
    expect(await tasksOf(ids.agent)).toEqual([]); // « maintenance » is not what it follows
    expect((await post(t.yao, `/assets/${ids.asset}`, { state: 'alert' })).status).toBe(200);
    await dispatchEvents(ORG);
    await dispatchEvents(ORG);
    const tasks = await tasksOf(ids.agent);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.thread_id).toBe(ids.thread);
    expect(tasks[0]?.instruction).toContain('Mini-centrale · École de Tsévié');
    expect(tasks[0]?.instruction).toContain('En maintenance → En alerte');
    // Every event read once: none is left for the worker.
    const left = await owner<{ n: number }>(
      `select count(*)::int as n from {s}.kete_events e where not exists (
         select 1 from {s}.event_deliveries d
          where d.event_id = e.event_id and d.consumer_key = 'seen')`,
    );
    expect(left[0]?.n).toBe(0);
  });

  it('stops following when it is set aside, and the gesture is kept', async () => {
    const stopped = await call(t.admin, 'PATCH', `/events/subscriptions/${ids.subscription}`, {
      active: false,
    });
    expect(stopped.status).toBe(200);
    await post(t.yao, `/assets/${ids.asset}`, { state: 'in_service' });
    await post(t.yao, `/assets/${ids.asset}`, { state: 'alert' });
    await dispatchEvents(ORG);
    expect(await tasksOf(ids.agent)).toHaveLength(1);
    const journal = await owner<{ name: string }>(
      `select name from {s}.kete_commands where name in ('follow-events', 'set-subscription')
        order by created_at`,
    );
    expect(journal.map((j) => j.name)).toEqual(['follow-events', 'set-subscription']);
  });
});

describe('an app’s event names its object (FR-002, FR-003)', () => {
  it('is said in the object’s thread by Kete; a secret one stays in the app’s log', async () => {
    const solved = await appEvent('ticket.solved', { kind: 'asset', id: ids.asset });
    await appEvent('pay.changed', { kind: 'asset', id: ids.asset });
    const logged = await owner<{ event_id: string; type: string }>(
      `select event_id, type from {s}.kete_events where source = 'app'`,
    );
    expect(logged).toEqual([{ event_id: solved, type: 'ticket.solved' }]);
    await dispatchEvents(ORG);
    await dispatchEvents(ORG);
    const lines = await owner<{ text: string; author_id: string; via: string }>(
      `select text, author_id, via from {s}.kete_messages where thread_id = $1
         and text like 'Support%'`,
      [ids.thread],
    );
    expect(lines).toEqual([
      {
        text: 'Support · Ticket résolu — Mini-centrale · École de Tsévié',
        author_id: 'agt_assistant',
        via: 'kete',
      },
    ]);
  });
});

describe('a delivery that fails (FR-006)', () => {
  it('is tried again, then given up after five attempts and shown to the administrator', async () => {
    const again = await appEvent('ticket.solved', { kind: 'asset', id: ids.asset });
    const given = await appEvent('ticket.solved', { kind: 'asset', id: ids.asset });
    // Two deliveries failed before: one may be tried again, the other has used its attempts.
    await db.owner.query(
      `insert into ${db.schema}.event_deliveries
         (organization_id, event_id, consumer_key, status, attempts, last_error)
       values ($1, $2, 'thread', 'failed', 2, 'timeout'), ($1, $3, 'thread', 'failed', 5, 'gone')`,
      [ORG, again, given],
    );
    await dispatchEvents(ORG);
    const status = await owner<{ event_id: string; status: string; attempts: number }>(
      `select event_id, status, attempts from {s}.event_deliveries
        where consumer_key = 'thread' and event_id in ($1, $2) order by attempts`,
      [again, given],
    );
    expect(status).toEqual([
      { event_id: again, status: 'done', attempts: 3 },
      { event_id: given, status: 'failed', attempts: 5 },
    ]);
    expect((await get(t.yao, '/events/failures')).status).toBe(403);
    const failures = (await get(t.admin, '/events/failures')).body.failures as {
      eventId: string;
      error: string;
    }[];
    expect(failures).toEqual([expect.objectContaining({ eventId: given, error: 'gone' })]);
  });
});
