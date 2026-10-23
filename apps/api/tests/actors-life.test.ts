import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { dispatchEvents } from '../src/features/events/index.js';
import { hourIn } from '../src/features/settings/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 107 (kete-core spec 149; doctrine D-062, R6, R12, R19): an object's life — closed, its thread
// is put away; opened again, its thread opens —; an agent's face from its template, sent with its
// threads; the hour of a moment where the organization is.

const ORG = 'org_actors_life';

let db: TestSchema;
const api = createApi();
const t = { admin: '', kossi: '' };
let key = 0;
const ids = {} as Record<'asset' | 'thread', string>;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `actors-life-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const get = (token: string, path: string) => call(token, 'GET', path);
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const threadState = async () =>
  (
    await db.owner.query<{ state: string }>(
      `select state from ${db.schema}.kete_threads where thread_id = $1`,
      [ids.thread],
    )
  ).rows[0]?.state;

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi', org: ORG });
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  const asset = await post(t.admin, '/assets', {
    name: 'Mini-centrale · Bè',
    holderUserId: 'usr_kossi',
  });
  ids.asset = (asset.body.asset as { assetId: string }).assetId;
  ids.thread = String((await get(t.admin, `/assets/${ids.asset}`)).body.threadId);
});

afterAll(async () => {
  await db?.drop();
});

describe('an object’s life (FR-001)', () => {
  it('puts its thread away when it closes, and opens it again when it opens', async () => {
    expect(await threadState()).toBe('open');
    await post(t.admin, `/assets/${ids.asset}`, { state: 'retired' });
    await dispatchEvents(ORG);
    expect(await threadState()).toBe('closed');
    // Closed, nothing more is said in it.
    expect(
      (await post(t.kossi, `/threads/${ids.thread}/messages`, { text: 'Encore ?' })).status,
    ).not.toBe(201);
    await post(t.admin, `/assets/${ids.asset}`, { state: 'in_service' });
    await dispatchEvents(ORG);
    expect(await threadState()).toBe('open');
  });
});

describe('an agent’s face (FR-002)', () => {
  it('comes from its template and travels with its threads', async () => {
    await post(t.admin, '/agents/catalogue/center/parc/enable');
    const taken = await post(t.kossi, '/agents/catalogue/center/parc/take');
    const agentId = (taken.body.agent as { agentId: string }).agentId;
    const thread = String((await post(t.kossi, `/threads/agents/${agentId}/thread`)).body.threadId);
    await post(t.kossi, `/threads/${thread}/messages`, { text: 'Bonjour' });
    const { rows } = await db.owner.query<{ face: unknown }>(
      `select face from ${db.schema}.agents where agent_id = $1`,
      [agentId],
    );
    expect(rows[0]?.face).toEqual({ glyph: 'sun', tint: 'amber' });
    const view = (await get(t.kossi, `/threads/${thread}`)).body as {
      faces: Record<string, unknown>;
    };
    expect(view.faces[agentId]).toEqual({ glyph: 'sun', tint: 'amber' });
  });
});

describe('the organization’s hour (FR-003)', () => {
  it('reads a moment where the organization is', () => {
    const at = new Date('2026-10-23T07:30:00Z');
    expect(hourIn(at, 'Africa/Lome')).toBe(7);
    expect(hourIn(at, 'Africa/Lagos')).toBe(8);
    expect(hourIn(at, 'Africa/Nairobi')).toBe(10);
  });
});
