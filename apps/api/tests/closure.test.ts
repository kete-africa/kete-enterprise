import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useClosureModel } from '../src/features/closure/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 083 (doctrine D-051): Awa's evening — « J'ai fini la relance Garage Bè. Le rapport SAV
// attendra lundi. Rappelle-moi l'appel à Ecobank jeudi. » Three gestures on her To do, applied
// together, undone together. The model is played; what is tested is what the center does with it.

let db: TestSchema;
const api = createApi();
const t = { awa: '', kofi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `closure-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
function playing(answer: (prompt: string) => unknown) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => ({
      content: [
        { type: 'text' as const, text: JSON.stringify(answer(JSON.stringify(options.prompt))) },
      ],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
}

type Task = { taskId: string; title: string; dueAt: string | null };
const tasksOf = async (): Promise<Task[]> => {
  const { rows } = await db.owner.query<{ task_id: string; title: string; due_at: Date | null }>(
    `select task_id, title, due_at from app_tasks where user_id = 'usr_awa' and status = 'open'`,
  );
  return rows.map((r) => ({
    taskId: r.task_id,
    title: r.title,
    dueAt: r.due_at ? r.due_at.toISOString() : null,
  }));
};
const ids = { relance: '', rapport: '' };

beforeAll(async () => {
  db = await startApi();
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  // Two tasks the apps put in her To do.
  for (const [k, title] of [
    ['relance', 'Relance Garage Bè'],
    ['rapport', 'Rapport SAV de septembre'],
  ] as const) {
    await post(t.awa, '/workspace/tasks', {
      source: 'kete-helpdesk',
      key: k,
      title,
      href: `https://helpdesk.example/${k}`,
      dueAt: '2026-10-14T17:00:00Z',
    });
  }
  const tasks = await tasksOf();
  ids.relance = tasks.find((x) => x.title === 'Relance Garage Bè')?.taskId ?? '';
  ids.rapport = tasks.find((x) => x.title === 'Rapport SAV de septembre')?.taskId ?? '';
});

afterAll(async () => {
  useClosureModel(undefined);
  await db?.drop();
});

describe('the evening’s closure', () => {
  it('says it is not connected without a model', async () => {
    useClosureModel(null);
    expect((await post(t.awa, '/closure', { text: 'Fini.' })).body).toMatchObject({
      error: 'assistant_unavailable',
    });
  });

  it('proposes gestures on her To do only, applied together and undone together', async () => {
    useClosureModel(
      playing((prompt) => {
        // She is shown her own tasks, nobody else's.
        expect(prompt).toContain('Relance Garage Bè');
        return {
          items: [
            {
              gesture: 'close',
              object: ids.relance,
              day: null,
              label: 'Clore « Relance Garage Bè »',
              reason: 'J’ai fini la relance Garage Bè.',
            },
            {
              gesture: 'postpone',
              object: ids.rapport,
              day: '2026-10-19',
              label: 'Reporter le rapport SAV à lundi',
              reason: 'attendra lundi',
            },
            {
              gesture: 'remind',
              object: null,
              day: '2026-10-15',
              label: 'Appeler Ecobank',
              reason: 'Rappelle-moi l’appel à Ecobank jeudi.',
            },
            // Without its day, a move is no gesture.
            {
              gesture: 'postpone',
              object: ids.relance,
              day: null,
              label: 'Reporter',
              reason: null,
            },
          ],
          unclear: [],
        };
      }),
    );
    const said = await post(t.awa, '/closure', {
      text: 'J’ai fini la relance Garage Bè. Le rapport SAV attendra lundi. Rappelle-moi l’appel à Ecobank jeudi.',
    });
    expect(said.status).toBe(200);
    const set = said.body.set as { id: string; items: { key: string; ticked: boolean }[] };
    expect(set.items.map((i) => i.key)).toEqual([
      `close-${ids.relance}`,
      `postpone-${ids.rapport}`,
      'remind-2',
    ]);
    // Kofi cannot decide her evening.
    expect((await post(t.kofi, `/closure/${set.id}/apply`, { ticked: [] })).status).toBe(404);
    const applied = await post(t.awa, `/closure/${set.id}/apply`, {
      ticked: set.items.map((i) => i.key),
    });
    expect((applied.body.set as { outcomes: Record<string, string> }).outcomes).toEqual({
      [`close-${ids.relance}`]: 'applied',
      [`postpone-${ids.rapport}`]: 'applied',
      'remind-2': 'applied',
    });
    let tasks = await tasksOf();
    expect(tasks.map((x) => x.title).sort()).toEqual([
      'Appeler Ecobank',
      'Rapport SAV de septembre',
    ]);
    expect(tasks.find((x) => x.title === 'Rapport SAV de septembre')?.dueAt).toBe(
      '2026-10-19T09:00:00.000Z',
    );
    expect(tasks.find((x) => x.title === 'Appeler Ecobank')?.dueAt).toBe(
      '2026-10-15T09:00:00.000Z',
    );
    // Undone together: her To do as it was.
    const undone = await post(t.awa, `/closure/${set.id}/undo`);
    expect((undone.body.set as { status: string }).status).toBe('undone');
    tasks = await tasksOf();
    expect(tasks.map((x) => x.title).sort()).toEqual([
      'Rapport SAV de septembre',
      'Relance Garage Bè',
    ]);
    expect(tasks.find((x) => x.title === 'Rapport SAV de septembre')?.dueAt).toBe(
      '2026-10-14T17:00:00.000Z',
    );
  });
});
