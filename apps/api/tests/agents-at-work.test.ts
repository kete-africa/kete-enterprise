import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { findAgent, runTask, stateOfAgent, useTaskModel } from '../src/features/agents/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 066 (doctrine D-044, D-045): she steers an agent while it works — pauses it, writes to it,
// takes the work over — and it obeys at its next step, keeping what it did. An agent is in one of
// six states, the same on every screen. An agent is private or shared: a colleague calls a shared
// one, and it then acts with the colleague's rights, never its owner's.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '', esi: '' };
const ids = {} as Record<'agent' | 'shared' | 'accounting', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `at-work-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type Task = {
  taskId: string;
  status: string;
  answer: string | null;
  steps: { tool: string; status: string }[];
  notes: { text: string; by: string }[];
  control: string | null;
  steeredBy: { userId: string; name: string } | null;
};
const give = async (token: string, agentId: string, instruction: string) =>
  ((await post(token, `/agents/${agentId}/tasks`, { instruction })).body.task as Task).taskId;
const read = async (token: string, taskId: string) =>
  (await get(token, `/agents/tasks/${taskId}`)).body.task as Task;
const steer = (token: string, taskId: string, gesture: string, body: object = {}) =>
  post(token, `/agents/tasks/${taskId}/${gesture}`, body);
const stateOf = async (token: string, agentId: string) => {
  const agents = (await get(token, '/agents')).body.agents as {
    agentId: string;
    state: { kind: string; by?: string; taskId?: string; reason?: string; step?: string };
  }[];
  return agents.find((agent) => agent.agentId === agentId)?.state;
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
const calling = (toolCallId: string) => ({
  content: [{ type: 'tool-call' as const, toolCallId, toolName: 'agents_available', input: '{}' }],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
  usage,
  warnings: [],
});
const saying = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: stop,
  usage,
  warnings: [],
});

/** What the model was told, each time it was called. */
const heard: string[] = [];
const hears = (options: unknown) => heard.push(JSON.stringify(options));
/**
 * A model at work: it takes one step, and while it thinks about the next one its person does
 * something — then it asks for a second step, which is where it finds out.
 */
const worksWhile = (meanwhile: () => Promise<unknown>) => {
  let turn = 0;
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      hears(options);
      turn += 1;
      if (turn === 1) return calling('c1');
      await meanwhile();
      return calling('c2');
    },
  });
};
const answers = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async (options) => {
      hears(options);
      return saying(text);
    },
  });

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
  const place = async (name: string, accountUserId: string, unitId: string, title: string) => {
    const positionId = (
      await post(t.admin, '/structure/positions', { unitId, title, startsOn: '2026-01-01' })
    ).body.positionId;
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
  ids.accounting = await unit('Comptabilité');
  await place('Awa Mensah', 'usr_awa', sav, 'Responsable SAV');
  await place('Kofi Agbo', 'usr_kofi', sav, 'Acheteur');
  await place('Esi Dossou', 'usr_esi', ids.accounting, 'Comptable');
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  const agent = async (token: string, name: string, mission: string) =>
    String(
      (await post(token, '/agents', { name, kind: 'personal', mission, watches: ['decisions'] }))
        .body.agentId ?? '',
    );
  ids.agent = await agent(t.awa, 'Agent SAV', 'Relancer les factures impayées du SAV.');
  ids.shared = await agent(t.kofi, 'Agent Achats', 'Donner le prix actuel des pièces.');
});

afterAll(async () => {
  useTaskModel(undefined);
  await db?.drop();
});

describe('an agent at work is paused, redirected and taken over', () => {
  it('waits when she pauses it before it starts, and goes on when she says', async () => {
    expect(await stateOf(t.awa, ids.agent)).toMatchObject({ kind: 'idle' });
    const taskId = await give(t.awa, ids.agent, 'Relance les impayés de septembre.');
    expect(await stateOf(t.awa, ids.agent)).toMatchObject({ kind: 'working', taskId });
    expect((await steer(t.awa, taskId, 'pause')).body.task).toMatchObject({ status: 'paused' });
    // Paused, it is not run.
    useTaskModel(answers('Je ne devrais pas répondre.'));
    await runTask('org_kya', taskId);
    expect(await read(t.awa, taskId)).toMatchObject({ status: 'paused', answer: null });
    expect(await stateOf(t.awa, ids.agent)).toMatchObject({
      kind: 'paused',
      taskId,
      by: 'Awa Mensah',
    });
    expect((await steer(t.awa, taskId, 'resume')).body.task).toMatchObject({ status: 'queued' });
    useTaskModel(answers('Sept relances préparées.'));
    expect(await runTask('org_kya', taskId)).toBe('done');
    expect(await stateOf(t.awa, ids.agent)).toMatchObject({ kind: 'idle' });
  });

  it('stops at its next step when she pauses it at work, and keeps what it did', async () => {
    const taskId = await give(t.awa, ids.agent, 'Relance les impayés d’octobre.');
    useTaskModel(worksWhile(() => steer(t.awa, taskId, 'pause')));
    expect(await runTask('org_kya', taskId)).toBe('paused');
    const paused = await read(t.awa, taskId);
    expect(paused).toMatchObject({
      status: 'paused',
      control: null,
      steps: [{ tool: 'agents_available', status: 'done' }],
      steeredBy: { userId: 'usr_awa', name: 'Awa Mensah' },
    });
    // It goes on from there, told what it already did.
    await steer(t.awa, taskId, 'resume');
    heard.length = 0;
    useTaskModel(answers('Quatre relances préparées.'));
    expect(await runTask('org_kya', taskId)).toBe('done');
    expect(heard[0]).toContain('agents_available');
    expect(await read(t.awa, taskId)).toMatchObject({
      status: 'done',
      answer: 'Quatre relances préparées.',
      steps: [{ tool: 'agents_available' }],
    });
  });

  it('takes her words before its instruction when she writes to it at work', async () => {
    const taskId = await give(t.awa, ids.agent, 'Relance tous les impayés.');
    const words = 'Seulement les factures de plus de trente jours.';
    useTaskModel(worksWhile(() => steer(t.awa, taskId, 'write', { text: words })));
    // Stopped at its next step, and queued again with what she wrote.
    expect(await runTask('org_kya', taskId)).toBe('queued');
    expect(await read(t.awa, taskId)).toMatchObject({
      status: 'queued',
      notes: [{ text: words, by: 'usr_awa' }],
    });
    heard.length = 0;
    useTaskModel(answers('Trois relances préparées, les plus anciennes.'));
    expect(await runTask('org_kya', taskId)).toBe('done');
    expect(heard[0]).toContain('plus de trente jours');
    expect((await steer(t.awa, taskId, 'write', { text: '' })).status).toBe(422);
  });

  it('hands the work back to her when she takes it over, in her « À faire »', async () => {
    const taskId = await give(t.awa, ids.agent, 'Chiffre le devis Garage Bè.');
    useTaskModel(worksWhile(() => steer(t.awa, taskId, 'take-over')));
    expect(await runTask('org_kya', taskId)).toBe('taken_over');
    expect(await read(t.awa, taskId)).toMatchObject({
      status: 'taken_over',
      answer: null,
      steps: [{ tool: 'agents_available' }],
      steeredBy: { name: 'Awa Mensah' },
    });
    const todo = JSON.stringify((await get(t.awa, '/workspace/tasks')).body);
    expect(todo).toContain('Repris à Agent SAV');
    expect(todo).toContain('Chiffre le devis Garage Bè');
    // Settled: nothing more steers it.
    for (const gesture of ['pause', 'resume', 'take-over']) {
      expect((await steer(t.awa, taskId, gesture)).status).toBe(409);
    }
    // Not yet started, it is hers at once.
    const next = await give(t.awa, ids.agent, 'Rappelle Mme Adjovi.');
    expect((await steer(t.awa, next, 'take-over')).body.task).toMatchObject({
      status: 'taken_over',
    });
  });

  it('is steered by its person only', async () => {
    const taskId = await give(t.awa, ids.agent, 'Prépare le point du lundi.');
    for (const gesture of ['pause', 'take-over', 'stop']) {
      expect((await steer(t.kofi, taskId, gesture)).status).toBe(403);
    }
    expect((await steer(t.kofi, taskId, 'write', { text: 'Fais autre chose.' })).status).toBe(403);
    expect((await get(t.kofi, `/agents/tasks/${taskId}`)).status).toBe(403);
    await steer(t.awa, taskId, 'stop');
    expect(await read(t.awa, taskId)).toMatchObject({
      status: 'stopped',
      steeredBy: { name: 'Awa Mensah' },
    });
  });

  it('says where it stands: blocked on what it lacks, stopped with the organization', async () => {
    const taskId = await give(t.awa, ids.agent, 'Relance les impayés de novembre.');
    useTaskModel(null);
    expect(await runTask('org_kya', taskId)).toBe('failed');
    expect(await stateOf(t.awa, ids.agent)).toMatchObject({
      kind: 'blocked',
      taskId,
      reason: 'assistant_unavailable',
    });
    // The kill switch closes the agents' screens; the other screens say « stopped ».
    const stopped = await transaction('org_kya', async (sql) => {
      const agent = await findAgent(sql, ids.agent);
      return agent ? stateOfAgent(sql, agent, false) : null;
    });
    expect(stopped).toMatchObject({ kind: 'stopped', reason: 'organization' });
  });
});

describe('an agent is private or shared', () => {
  const share = (token: string, body: object) => post(token, `/agents/${ids.shared}/sharing`, body);
  const sharedWith = async (token: string) =>
    ((await get(token, '/agents')).body.shared as { agentId: string }[]).map((a) => a.agentId);

  it('is its person’s alone while private', async () => {
    expect(await sharedWith(t.awa)).toEqual([]);
    expect((await post(t.awa, `/agents/${ids.shared}/tasks`, { instruction: 'x' })).status).toBe(
      403,
    );
  });

  it('is opened by its person, to the units she chooses', async () => {
    expect((await share(t.awa, { visibility: 'shared' })).status).toBe(403);
    expect(
      (await share(t.kofi, { visibility: 'shared', sharedWith: ['unt_00000000'] })).status,
    ).toBe(409);
    expect(
      (await share(t.kofi, { visibility: 'shared', sharedWith: [ids.accounting] })).status,
    ).toBe(201);
    expect(await sharedWith(t.esi)).toEqual([ids.shared]);
    expect(await sharedWith(t.awa)).toEqual([]);
    expect((await share(t.kofi, { visibility: 'shared' })).status).toBe(201);
    expect(await sharedWith(t.awa)).toEqual([ids.shared]);
    // Its owner sees it among her own, not among those shared with her.
    expect(await sharedWith(t.kofi)).toEqual([]);
  });

  it('acts for the colleague who calls it — her rights, her task, her answer', async () => {
    const taskId = await give(t.awa, ids.shared, 'Prix actuel des trois pièces du devis Bè ?');
    useTaskModel(answers('Prix au 13 octobre : 148 000 F CFA.'));
    expect(await runTask('org_kya', taskId)).toBe('done');
    // The journal's two names: the agent, at the request of who called it.
    const { rows } = await db.owner.query<{ given_by: string }>(
      `select given_by from ${db.schema}.agent_tasks where task_id = $1`,
      [taskId],
    );
    expect(rows[0]?.given_by).toBe('usr_awa');
    const told = (await get(t.awa, '/notifications')).body.notifications as { title: string }[];
    expect(told[0]?.title).toContain('Agent Achats');
    // She follows what she asked; a colleague who did not ask does not.
    expect(await read(t.awa, taskId)).toMatchObject({ status: 'done' });
    expect((await get(t.esi, `/agents/tasks/${taskId}`)).status).toBe(403);
    // Its owner sees what his agent did for others.
    expect(await read(t.kofi, taskId)).toMatchObject({ status: 'done' });
  });

  it('is closed again by its person', async () => {
    expect((await share(t.kofi, { visibility: 'private' })).status).toBe(201);
    expect(await sharedWith(t.awa)).toEqual([]);
    expect((await post(t.awa, `/agents/${ids.shared}/tasks`, { instruction: 'x' })).status).toBe(
      403,
    );
  });
});
