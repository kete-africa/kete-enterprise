import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runTask, useTaskModel } from '../src/features/agents/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 065 (doctrine D-044): work is asked of a person, never of her private agents. The request
// has its states; the person asked may hand it to her own agent; what comes back is signed by her,
// and says whether an agent prepared it. Two people and an agent work in one thread.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '', esi: '' };
let key = 0;
let requestId = '';
let agentId = '';

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `requests-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const move = (token: string, body: object) => post(token, `/requests/${requestId}/moves`, body);
const read = async (token: string) =>
  (await get(token, `/requests/${requestId}`)).body.request as {
    status: string;
    agent: { name: string; work: string | null } | null;
    returned: { text: string; signedBy: string; preparedBy: string | null } | null;
    events: { kind: string; actor: { kind: string; name: string }; text: string }[];
  };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const PREPARED =
  'Devis Garage Bè : remplacement de 8 batteries 200 Ah, pose comprise — 2 480 000 F CFA HT.';

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi Dossou' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = async (name: string) =>
    (await post(t.admin, '/structure/units', { unitTypeId: type, name, startsOn: '2026-01-01' }))
      .body.unitId as string;
  const position = async (unitId: string, title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
  const assign = async (name: string, accountUserId: string, positionId: string) => {
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  };
  const sav = await unit('Service après-vente');
  const chef = await position(sav, 'Responsable SAV');
  await assign('Awa Mensah', 'usr_awa', chef);
  await assign('Kofi Agbo', 'usr_kofi', await position(sav, 'Technicien devis', chef));
  // Esi works elsewhere, linked to neither.
  await assign('Esi Dossou', 'usr_esi', await position(await unit('Comptabilité'), 'Comptable'));
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  agentId = String(
    (
      await post(t.kofi, '/agents', {
        name: 'Agent Devis',
        kind: 'personal',
        mission: 'Préparer les devis du SAV.',
        watches: ['decisions'],
      })
    ).body.agentId ?? '',
  );
});

afterAll(async () => {
  useTaskModel(undefined);
  await db?.drop();
});

describe('a request to a colleague', () => {
  it('goes to a person, with its state, into her « À faire »', async () => {
    const asked = await post(t.awa, '/requests', {
      colleague: 'Kofi Agbo',
      title: 'Chiffre le devis Garage Bè',
      detail: 'Huit batteries à remplacer sur le site de Bè.',
      dueOn: '2026-10-16',
    });
    expect(asked).toMatchObject({
      status: 201,
      body: { request: { status: 'received', to: { name: 'Kofi Agbo' } } },
    });
    requestId = (asked.body.request as { requestId: string }).requestId;
    const todo = (await get(t.kofi, '/workspace/tasks')).body;
    expect(JSON.stringify(todo)).toContain('Chiffre le devis Garage Bè');
    expect((await get(t.kofi, '/requests')).body).toMatchObject({
      received: [{ requestId, status: 'received' }],
      sent: [],
    });
  });

  it('is nobody else’s', async () => {
    expect((await get(t.esi, `/requests/${requestId}`)).status).toBe(404);
    expect((await move(t.esi, { kind: 'note', text: 'Moi aussi ?' })).status).toBe(404);
  });

  it('is handed by the person asked to her own agent — never to another’s', async () => {
    const awaAgent = String(
      (
        await post(t.awa, '/agents', {
          name: 'Agent Awa',
          kind: 'personal',
          mission: 'Aider Awa.',
          watches: ['decisions'],
        })
      ).body.agentId ?? '',
    );
    expect((await move(t.kofi, { kind: 'hand', agentId: awaAgent })).status).toBe(403);
    expect((await move(t.awa, { kind: 'hand', agentId })).status).toBe(403);
    const handed = await move(t.kofi, { kind: 'hand', agentId });
    expect(handed.body.request).toMatchObject({
      status: 'taken',
      agent: { name: 'Agent Devis', work: 'queued' },
    });
  });

  it('shows what the agent did to her, and only that an agent worked to who asked', async () => {
    useTaskModel(
      new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: 'text', text: PREPARED }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        },
      }),
    );
    const { body } = await get(t.kofi, `/requests/${requestId}`);
    const task = String((body.request as { agent: { work: string } }).agent.work);
    expect(task).toBe('queued');
    const tasks = await db.owner.query<{ task_id: string; organization_id: string }>(
      `select organization_id, task_id from agent_tasks where agent_id = $1`,
      [agentId],
    );
    const queued = tasks.rows[0];
    expect(await runTask(queued?.organization_id ?? '', queued?.task_id ?? '')).toBe('done');
    const hers = await read(t.kofi);
    expect(hers.events.at(-1)).toMatchObject({
      kind: 'agent_done',
      actor: { kind: 'agent', name: 'Agent Devis' },
      text: PREPARED,
    });
    const his = await read(t.awa);
    expect(his.events.at(-1)).toMatchObject({ kind: 'agent_done', text: '' });
  });

  it('waits for who asked when the person asked needs her, and goes on once answered', async () => {
    expect((await move(t.awa, { kind: 'wait', question: 'Quoi ?' })).status).toBe(403);
    await move(t.kofi, { kind: 'wait', question: 'Pose comprise, ou batteries seules ?' });
    expect((await read(t.awa)).status).toBe('waiting');
    expect(JSON.stringify((await get(t.awa, '/workspace/tasks')).body)).toContain('Kofi Agbo');
    await move(t.awa, { kind: 'answer', text: 'Pose comprise.' });
    expect((await read(t.kofi)).status).toBe('taken');
  });

  it('comes back signed by the person asked, saying her agent prepared it', async () => {
    expect((await move(t.awa, { kind: 'return', text: 'Fait.' })).status).toBe(403);
    const returned = await move(t.kofi, { kind: 'return', text: PREPARED });
    expect(returned.body.request).toMatchObject({
      status: 'returned',
      returned: { text: PREPARED, signedBy: 'usr_kofi', preparedBy: agentId },
    });
    const thread = await read(t.awa);
    // Two people and an agent, in one thread.
    expect([...new Set(thread.events.map((event) => event.actor.name))].sort()).toEqual([
      'Agent Devis',
      'Awa Mensah',
      'Kofi Agbo',
    ]);
    expect(thread.events.map((event) => event.kind)).toEqual([
      'asked',
      'handed',
      'agent_done',
      'waiting',
      'answered',
      'returned',
    ]);
    // Settled: nothing more can move it.
    expect((await move(t.awa, { kind: 'cancel' })).status).toBe(409);
  });

  it('reminds once a day at most, and is cancelled by who asked', async () => {
    const again = await post(t.awa, '/requests', {
      colleague: 'Kofi',
      title: 'Rappeler Mme Adjovi',
    });
    requestId = (again.body.request as { requestId: string }).requestId;
    expect((await move(t.awa, { kind: 'remind' })).status).toBe(200);
    expect((await move(t.awa, { kind: 'remind' })).status).toBe(429);
    expect((await move(t.awa, { kind: 'cancel' })).body.request).toMatchObject({
      status: 'cancelled',
    });
    expect(JSON.stringify((await get(t.kofi, '/workspace/tasks')).body)).not.toContain(
      'Rappeler Mme Adjovi',
    );
  });

  it('cannot be asked of oneself, nor of someone unknown', async () => {
    expect((await post(t.awa, '/requests', { colleague: 'Awa Mensah', title: 'x' })).status).toBe(
      422,
    );
    expect((await post(t.awa, '/requests', { colleague: 'Personne', title: 'x' })).status).toBe(
      404,
    );
  });
});
