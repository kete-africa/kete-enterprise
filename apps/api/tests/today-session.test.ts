import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runTask, useTaskModel } from '../src/features/agents/index.js';
import { useNoteModel } from '../src/features/notes/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 058: « Aujourd'hui » as a session — a subject set aside for today leaves the session and
// is taken back when she wants — and « Pendant ce temps », what her agents are doing right now.

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
      'idempotency-key': `session-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const says = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });

type Today = {
  day: { kind: string; id: string; title: string }[];
  later: string[];
  meanwhile: {
    agents: { taskId: string; agentName: string; instruction: string; status: string }[];
    routines: unknown[];
  };
  done: { taskId: string }[];
};
const today = async (token: string) => (await call(token, 'GET', '/today')).body as Today;

beforeAll(async () => {
  db = await startApi();
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { role: 'member', name: 'Kofi' });
});

afterAll(async () => {
  useNoteModel(undefined);
  useTaskModel(undefined);
  await db?.drop();
});

describe('« Aujourd’hui » as a session', () => {
  let subject = '';

  it('sets a subject aside for today, hers alone, and takes it back', async () => {
    // A subject of her day: a reminder from her notebook.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    useNoteModel(
      says(
        JSON.stringify({
          summary: 'Appeler le fournisseur.',
          reminder: { title: 'Appeler le fournisseur', at: `${tomorrow}T09:00` },
        }),
      ),
    );
    await call(t.awa, 'POST', '/notes', { text: 'Appeler le fournisseur demain à 9 h' });
    const before = await today(t.awa);
    expect(before.later).toEqual([]);
    const item = before.day.find((x) => x.title === 'Appeler le fournisseur');
    subject = `${item?.kind}:${item?.id}`;
    expect(subject).toMatch(/^app_task:tsk_/);

    expect((await call(t.awa, 'POST', '/today/later', { key: subject })).status).toBe(200);
    // Set aside twice is set aside once.
    await call(t.awa, 'POST', '/today/later', { key: subject });
    const after = await today(t.awa);
    expect(after.later).toEqual([subject]);
    // It still waits: only the session leaves it out.
    expect(after.day.some((x) => `${x.kind}:${x.id}` === subject)).toBe(true);
    expect((await today(t.kofi)).later).toEqual([]);

    expect((await call(t.awa, 'POST', '/today/resume', { key: subject })).status).toBe(200);
    expect((await today(t.awa)).later).toEqual([]);
  });

  it('takes everything back at once, and refuses what is not a subject of the day', async () => {
    await call(t.awa, 'POST', '/today/later', { key: subject });
    await call(t.awa, 'POST', '/today/later', { key: 'decision:req_1234' });
    expect((await today(t.awa)).later.length).toBe(2);
    expect((await call(t.awa, 'POST', '/today/resume', {})).status).toBe(200);
    expect((await today(t.awa)).later).toEqual([]);
    expect((await call(t.awa, 'POST', '/today/later', { key: 'anything' })).status).toBe(422);
    expect((await call(t.awa, 'POST', '/today/later', {})).status).toBe(422);
  });

  it('forgets yesterday’s: a subject set aside comes back the next day', async () => {
    await db.owner.query(
      `insert into ${db.schema}.today_set_aside (organization_id, user_id, item_key, day)
       values ('org_kya', 'usr_awa', $1, current_date - 1)`,
      [subject],
    );
    expect((await today(t.awa)).later).toEqual([]);
    // The next gesture clears what is past.
    await call(t.awa, 'POST', '/today/later', { key: 'note:nte_1234' });
    const { rows } = await db.owner.query(
      `select item_key from ${db.schema}.today_set_aside where user_id = 'usr_awa'`,
    );
    expect(rows).toEqual([{ item_key: 'note:nte_1234' }]);
  });
});

describe('« Pendant ce temps »', () => {
  it('shows what her agents are doing now, until it is done', async () => {
    const agentId = String(
      (
        await call(t.awa, 'POST', '/agents', {
          name: 'Agent de rédaction',
          kind: 'personal',
          mission: 'Rédiger mes relances.',
          watches: ['decisions'],
        })
      ).body.agentId,
    );
    const taskId = (
      (
        await call(t.awa, 'POST', `/agents/${agentId}/tasks`, {
          instruction: 'Rédige la relance du client Mensah.',
        })
      ).body.task as { taskId: string }
    ).taskId;
    expect((await today(t.awa)).meanwhile.agents).toEqual([
      {
        taskId,
        agentName: 'Agent de rédaction',
        instruction: 'Rédige la relance du client Mensah.',
        status: 'queued',
      },
    ]);
    // Her colleague sees nothing of it.
    expect((await today(t.kofi)).meanwhile).toEqual({ agents: [], routines: [] });

    useTaskModel(says('Voici la relance : Madame, …'));
    expect(await runTask('org_kya', taskId)).toBe('done');
    const after = await today(t.awa);
    expect(after.meanwhile.agents).toEqual([]);
    expect(after.done.map((d) => d.taskId)).toEqual([taskId]);
  });
});
