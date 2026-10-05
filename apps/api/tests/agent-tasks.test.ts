import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runTask, useTaskModel } from '../src/features/agents/index.js';
import { toolsForAgent } from '../src/features/gateway/index.js';
import { asPerson } from '../src/platform/acting.js';
import { startApi, tokenFor } from './support.js';

// Spec 036: a task given to an agent runs in the background with its person's capabilities,
// narrowed to its job description — its permissions, its autonomy, its budget of drafts — every
// commitment a draft she decides; an agent hands part of it to another of her agents, the chain
// carried; the kill switch stops them all.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
const ids = {} as Record<'awa' | 'planner' | 'writer' | 'first', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `tasks-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const id = async (token: string, path: string, body: object, field: string) =>
  String((await call(token, 'POST', path, body)).body[field] ?? '');

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
/** A model that calls one tool, then answers. */
const callsThenAnswers = (toolName: string, input: object, text: string) =>
  new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName, input: JSON.stringify(input) }],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      },
      { content: [{ type: 'text', text }], finishReason: stop, usage, warnings: [] },
    ],
  });
const answers = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: { content: [{ type: 'text', text }], finishReason: stop, usage, warnings: [] },
  });

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { role: 'member', name: 'Kofi' });
  await call(t.admin, 'POST', '/organization/modules', { module: 'meetings', enabled: true });
  const type = await id(
    t.admin,
    '/structure/unit-types',
    { key: 'unit', name: 'Unité' },
    'unitTypeId',
  );
  const unit = await id(
    t.admin,
    '/structure/units',
    { unitTypeId: type, name: 'Agence de Lomé', startsOn: '2026-01-01' },
    'unitId',
  );
  const position = await id(
    t.admin,
    '/structure/positions',
    { unitId: unit, title: 'Commerciale', startsOn: '2026-01-01' },
    'positionId',
  );
  ids.awa = await id(
    t.admin,
    '/structure/people',
    { name: 'Awa', accountUserId: 'usr_awa' },
    'personId',
  );
  await call(t.admin, 'POST', '/structure/assignments', {
    personId: ids.awa,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  const role = await id(
    t.admin,
    '/rights/roles',
    { name: 'Réunions', permissions: ['meetings:manage'] },
    'roleId',
  );
  await call(t.admin, 'POST', '/rights/grants', {
    roleId: role,
    positionId: position,
    startsOn: '2026-01-01',
  });
  ids.planner = await id(
    t.awa,
    '/agents',
    {
      name: 'Agent de suivi',
      kind: 'personal',
      mission: 'Préparer les actions de mes réunions.',
      permissions: ['meetings:manage'],
      autonomyMax: 3,
      draftBudget: 1,
      watches: ['decisions'],
    },
    'agentId',
  );
  ids.writer = await id(
    t.awa,
    '/agents',
    {
      name: 'Agent de rédaction',
      kind: 'personal',
      mission: 'Rédiger mes relances.',
      watches: ['decisions'],
    },
    'agentId',
  );
});

afterAll(async () => {
  useTaskModel(undefined);
  await db?.drop();
});

const give = async (agentId: string, instruction: string) =>
  (
    (await call(t.awa, 'POST', `/agents/${agentId}/tasks`, { instruction })).body.task as {
      taskId: string;
    }
  ).taskId;
const read = async (taskId: string) =>
  (await call(t.awa, 'GET', `/agents/tasks/${taskId}`)).body as {
    task: {
      status: string;
      answer: string;
      steps: { tool: string; status: string }[];
      draftIds: string[];
      delegatedBy: string[];
    };
    handedOn: { taskId: string; agentId: string; delegatedBy: string[]; status: string }[];
  };

describe('a task given to an agent', () => {
  it('is given by its person only, and queued', async () => {
    expect(
      (await call(t.kofi, 'POST', `/agents/${ids.planner}/tasks`, { instruction: 'x' })).status,
    ).toBe(403);
    ids.first = await give(ids.planner, 'Prépare l’action de relancer le client Mensah.');
    expect((await read(ids.first)).task.status).toBe('queued');
  });

  it('runs with her capabilities, every commitment a draft for her, and tells her', async () => {
    useTaskModel(
      callsThenAnswers(
        'actions_propose',
        { title: 'Relancer le client Mensah', responsiblePersonId: ids.awa, dueOn: '2026-11-15' },
        'J’ai préparé l’action ; elle attend votre validation.',
      ),
    );
    expect(await runTask('org_kya', ids.first)).toBe('done');
    const { task } = await read(ids.first);
    expect(task).toMatchObject({
      status: 'done',
      steps: [{ tool: 'actions_propose', status: 'draft' }],
      answer: expect.stringContaining('validation'),
    });
    expect(task.draftIds).toHaveLength(1);
    const { rows } = await db.owner.query(
      `select prepared_by_id, on_behalf_of_id, status from ${db.schema}.kete_drafts where draft_id = $1`,
      [task.draftIds[0]],
    );
    expect(rows[0]).toMatchObject({
      prepared_by_id: ids.planner,
      on_behalf_of_id: 'usr_awa',
      status: 'prepared',
    });
    const told = (await call(t.awa, 'GET', '/notifications')).body.notifications as {
      title: string;
    }[];
    expect(told[0]?.title).toContain('Agent de suivi');
  });

  it('waits for her decisions once its budget of drafts is spent', async () => {
    const second = await give(ids.planner, 'Prépare une autre action.');
    useTaskModel(
      callsThenAnswers(
        'actions_propose',
        { title: 'Appeler le fournisseur', responsiblePersonId: ids.awa, dueOn: '2026-11-20' },
        'Je n’ai pas pu préparer l’action.',
      ),
    );
    await runTask('org_kya', second);
    expect((await read(second)).task.steps).toEqual([
      { tool: 'actions_propose', status: 'refused' },
    ]);
  });

  it('holds only what its job description lists', async () => {
    const tools = (agentId: string, permissions: string[]) =>
      asPerson(
        {
          organizationId: 'org_kya',
          userId: 'usr_awa',
          email: '',
          name: '',
          role: null,
          apps: {},
          twoFactor: false,
          expiresAt: new Date(),
        },
        async () =>
          (
            await toolsForAgent(
              { organizationId: 'org_kya', userId: 'usr_awa' },
              {
                kind: 'agent',
                id: agentId,
                channel: 'worker',
                onBehalfOf: { kind: 'person', id: 'usr_awa' },
              },
              { permissions, autonomyMax: 3, draftBudget: 5 },
            )
          ).map((tool) => tool.name),
      );
    expect(await tools(ids.planner, ['meetings:manage'])).toContain('actions_propose');
    expect(await tools(ids.writer, [])).not.toContain('actions_propose');
  });

  it('hands part of the work to another of her agents, the chain carried', async () => {
    const parent = await give(ids.planner, 'Fais rédiger la relance par l’agent de rédaction.');
    useTaskModel(
      callsThenAnswers(
        'delegate_task',
        { agentId: ids.writer, instruction: 'Rédige la relance du client Mensah.' },
        'J’ai confié la rédaction.',
      ),
    );
    expect(await runTask('org_kya', parent)).toBe('done');
    const { handedOn } = await read(parent);
    expect(handedOn).toEqual([
      expect.objectContaining({
        agentId: ids.writer,
        delegatedBy: [ids.planner],
        status: 'queued',
      }),
    ]);
    useTaskModel(answers('Voici la relance : Madame, …'));
    expect(await runTask('org_kya', handedOn[0]?.taskId ?? '')).toBe('done');
    // An agent of the chain is never asked again: the writer, asked by the planner, cannot hand
    // the work back to it.
    const again = await give(String(ids.planner), 'Fais rédiger une autre relance.');
    useTaskModel(
      callsThenAnswers(
        'delegate_task',
        { agentId: ids.writer, instruction: 'Rédige une autre relance.' },
        'Confié.',
      ),
    );
    await runTask('org_kya', again);
    const child = (await read(again)).handedOn[0]?.taskId ?? '';
    useTaskModel(
      callsThenAnswers('delegate_task', { agentId: ids.planner, instruction: 'Reprends.' }, 'Non.'),
    );
    await runTask('org_kya', child);
    expect((await read(child)).task.steps).toEqual([{ tool: 'delegate_task', status: 'refused' }]);
  });

  it('is stopped by her, and by the kill switch', async () => {
    const queued = await give(ids.writer, 'Une tâche à arrêter.');
    expect((await call(t.awa, 'POST', `/agents/tasks/${queued}/stop`)).body).toEqual({
      stopped: true,
    });
    const later = await give(ids.writer, 'Une tâche après l’arrêt général.');
    await call(t.admin, 'POST', '/organization/modules', { module: 'agents', enabled: false });
    useTaskModel(answers('Rien.'));
    expect(await runTask('org_kya', later)).toBe('stopped');
    await call(t.admin, 'POST', '/organization/modules', { module: 'agents', enabled: true });
  });
});
