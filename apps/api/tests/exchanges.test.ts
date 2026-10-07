import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { colleagueTool } from '../src/features/exchanges/index.js';
import { useNoteModel } from '../src/features/notes/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 057: a person's assistant asks a colleague's. The colleague's assistant answers alone only
// on what she allowed, with moments and counts and nothing else; anything else is passed to her,
// in her « À faire »; both see every exchange.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', awa: '', kofi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `exchanges-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = async (path: string, body: object) => (await call(t.admin, 'POST', path, body)).body;

type Exchange = {
  exchangeId: string;
  status: string;
  answer: string | null;
  subject: string;
  from: { name: string };
  to: { name: string };
};
const exchanges = async (token: string) =>
  (await call(token, 'GET', '/exchanges')).body as {
    allowed: string[];
    received: Exchange[];
    sent: Exchange[];
  };
type Task = { source: string; title: string };
const waitingFor = async (token: string) =>
  ((await call(token, 'GET', '/workspace/tasks')).body.tasks as Task[]).filter(
    (x) => x.source === 'exchanges',
  );

/** Awa's assistant, as her chat holds it. */
const awa = () =>
  colleagueTool({ organizationId: 'org_kya', userId: 'usr_awa', role: 'member', name: 'Awa' });
const kofi = () =>
  colleagueTool({ organizationId: 'org_kya', userId: 'usr_kofi', role: 'member', name: 'Kofi' });
type Said = {
  status: string;
  reason?: string;
  output?: { answeredBy: string; answer?: string; passedToHer?: boolean };
};
const asks = async (
  tool: ReturnType<typeof colleagueTool>,
  colleague: string,
  subject: string,
  question: string,
) => (await tool.execute({ colleague, subject, question })) as Said;

beforeAll(async () => {
  db = await startApi();
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.abla = await tokenFor('usr_abla', { role: 'member', name: 'Abla' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { role: 'member', name: 'Kofi' });
  const type = (await post('/structure/unit-types', { key: 'unit', name: 'Unité' }))
    .unitTypeId as string;
  const unit = async (name: string, parentId?: string) =>
    (
      await post('/structure/units', {
        unitTypeId: type,
        name,
        startsOn: '2026-01-01',
        ...(parentId ? { parentId } : {}),
      })
    ).unitId as string;
  const technique = await unit('Direction Technique & Projets');
  const sav = await unit('Service après-vente', technique);
  const position = async (unitId: string, title: string, reportsTo?: string) =>
    (
      await post('/structure/positions', {
        unitId,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).positionId as string;
  const dt = await position(technique, 'Directrice technique');
  const chef = await position(sav, 'Cheffe de service SAV', dt);
  const tech = await position(sav, 'Technicien SAV', chef);
  const person = async (name: string, accountUserId: string) =>
    (await post('/structure/people', { name, accountUserId })).personId as string;
  const assign = async (personId: string, positionId: string) =>
    post('/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  await assign(await person('Abla', 'usr_abla'), dt);
  await assign(await person('Awa', 'usr_awa'), chef);
  await assign(await person('Kofi', 'usr_kofi'), tech);
});

afterAll(async () => {
  useNoteModel(undefined);
  await db?.drop();
});

describe('an exchange between assistants', () => {
  let passed = '';

  it('is passed to the colleague when she allowed nothing — the default', async () => {
    expect((await exchanges(t.kofi)).allowed).toEqual([]);
    const said = await asks(awa(), 'Kofi', 'availability', 'Es-tu libre jeudi matin ?');
    expect(said).toMatchObject({
      status: 'done',
      output: { answeredBy: 'nobody_yet', passedToHer: true },
    });
    const { received } = await exchanges(t.kofi);
    expect(received).toEqual([
      expect.objectContaining({
        status: 'waiting',
        answer: null,
        from: { userId: 'usr_awa', name: 'Awa' },
      }),
    ]);
    passed = received[0]?.exchangeId ?? '';
    expect(await waitingFor(t.kofi)).toEqual([
      expect.objectContaining({ title: expect.stringContaining('Es-tu libre jeudi matin ?') }),
    ]);
    const told = (await call(t.kofi, 'GET', '/notifications')).body.notifications as {
      title: string;
    }[];
    expect(told[0]?.title).toContain('Awa');
    expect((await exchanges(t.awa)).sent[0]).toMatchObject({ status: 'waiting' });
  });

  it('is answered by the colleague only, who leaves her « À faire »; the asker is told', async () => {
    expect((await call(t.awa, 'POST', `/exchanges/${passed}/reply`, { answer: 'x' })).status).toBe(
      404,
    );
    expect(
      (await call(t.kofi, 'POST', `/exchanges/${passed}/reply`, { answer: 'Oui, dès 9 h.' }))
        .status,
    ).toBe(200);
    expect(await waitingFor(t.kofi)).toEqual([]);
    expect((await exchanges(t.awa)).sent[0]).toMatchObject({
      status: 'replied',
      answer: 'Oui, dès 9 h.',
    });
    const told = (await call(t.awa, 'GET', '/notifications')).body.notifications as {
      title: string;
    }[];
    expect(told[0]?.title).toContain('Kofi');
    // Settled once.
    expect((await call(t.kofi, 'POST', `/exchanges/${passed}/decline`)).status).toBe(404);
  });

  it('is answered alone on what she allowed: moments, never what they are', async () => {
    expect((await call(t.awa, 'POST', '/exchanges/settings', { allowed: ['salary'] })).status).toBe(
      422,
    );
    expect(
      (await call(t.kofi, 'POST', '/exchanges/settings', { allowed: ['availability'] })).body,
    ).toEqual({ allowed: ['availability'] });
    // Kofi has one dated commitment: a reminder from his notebook, tomorrow at 10:00.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    useNoteModel(
      new MockLanguageModelV4({
        doGenerate: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary: 'Rendez-vous chez le médecin.',
                reminder: { title: 'Rendez-vous médecin', at: `${tomorrow}T10:00` },
              }),
            },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        },
      }),
    );
    await call(t.kofi, 'POST', '/notes', { text: 'Médecin demain à 10 h' });
    const said = await asks(awa(), 'usr_kofi', 'availability', 'Quand es-tu libre cette semaine ?');
    expect(said.output?.answeredBy).toBe('her_assistant');
    expect(said.output?.answer).toContain('10:00');
    expect(said.output?.answer).not.toContain('médecin');
    expect(said.output?.answer).toContain('aucun agenda');
    // He sees what his assistant said for him; nothing new waits for him.
    expect((await exchanges(t.kofi)).received[0]).toMatchObject({
      status: 'answered',
      subject: 'availability',
      answer: expect.stringContaining('10:00'),
    });
    expect(await waitingFor(t.kofi)).toEqual([]);
  });

  it('stays passed for a subject she did not allow, and is taken back by the asker', async () => {
    const said = await asks(awa(), 'Kofi', 'workload', 'As-tu beaucoup de choses en cours ?');
    expect(said.output).toMatchObject({ answeredBy: 'nobody_yet' });
    const waiting = (await exchanges(t.awa)).sent[0]?.exchangeId ?? '';
    expect((await waitingFor(t.kofi)).length).toBe(1);
    expect((await call(t.kofi, 'POST', `/exchanges/${waiting}/withdraw`)).status).toBe(404);
    expect((await call(t.awa, 'POST', `/exchanges/${waiting}/withdraw`)).status).toBe(200);
    expect(await waitingFor(t.kofi)).toEqual([]);
    expect((await exchanges(t.kofi)).received.map((e) => e.exchangeId)).not.toContain(waiting);
  });

  it('reaches only a colleague her rights let her see, and never herself', async () => {
    expect(await asks(awa(), 'Inconnu', 'other', 'Bonjour ?')).toMatchObject({
      status: 'refused',
    });
    expect(await asks(awa(), 'Awa', 'other', 'Bonjour ?')).toMatchObject({ status: 'refused' });
    // Kofi does not see Abla in the directory: his assistant cannot ask hers.
    expect(await asks(kofi(), 'Abla', 'other', 'Bonjour ?')).toMatchObject({ status: 'refused' });
    expect((await exchanges(t.abla)).received).toEqual([]);
  });
});
