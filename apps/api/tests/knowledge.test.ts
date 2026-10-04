import type { TestSchema } from '@kete/testing';
import type { Embedder } from '@kete/knowledge';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { unitKeys, useEmbedder } from '../src/features/knowledge/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 028: the company's library — sources an administrator switches on or off and opens to an
// audience, documents read and searched with their citations, each person reading only what her
// audience opens; the assistant cites them.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '', esi: '' };
let key = 0;

/** A deterministic embedder: words hashed into the table's dimensions. Nothing leaves the test. */
const fake: Embedder = {
  dimensions: 1536,
  async embed(texts) {
    return texts.map((text) => {
      const v = new Array<number>(1536).fill(0);
      for (const word of text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\W+/)) {
        if (word.length < 3) continue;
        let h = 0;
        for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        v[h % 1536] = (v[h % 1536] ?? 0) + 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  },
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `knowledge-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

beforeAll(async () => {
  db = await startApi();
  useEmbedder(fake);
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
});

afterAll(async () => {
  useEmbedder(undefined);
  useModel(undefined);
  await db?.drop();
});

describe('who reads what', () => {
  it('opens a unit’s documents to its teams below it, never above', () => {
    const units = [
      { unitId: 'dg', parentId: null },
      { unitId: 'sav', parentId: 'dg' },
      { unitId: 'lome', parentId: 'sav' },
      { unitId: 'qualite', parentId: 'dg' },
    ];
    expect(unitKeys(['lome'], units).sort()).toEqual(['unit:dg', 'unit:lome', 'unit:sav']);
    expect(unitKeys(['qualite'], units)).not.toContain('unit:sav');
  });
});

describe('the company’s library', () => {
  let quality = '';
  let sav = '';

  it('answers only when its module is on', async () => {
    expect((await call(t.kofi, 'GET', '/knowledge/sources')).body).toMatchObject({
      error: 'module_disabled',
    });
    await call(t.admin, 'POST', '/organization/modules', { module: 'knowledge', enabled: true });
    expect((await call(t.kofi, 'GET', '/knowledge/sources')).status).toBe(200);
  });

  it('lets administrators only set sources and their audience', async () => {
    expect((await call(t.kofi, 'POST', '/knowledge/sources', { name: 'Mes notes' })).status).toBe(
      403,
    );
    const q = await call(t.admin, 'POST', '/knowledge/sources', {
      name: 'Procédures qualité',
      audience: ['everyone'],
    });
    expect(q).toMatchObject({
      status: 201,
      body: { source: { name: 'Procédures qualité', enabled: true, audience: ['everyone'] } },
    });
    quality = (q.body.source as { sourceId: string }).sourceId;
    sav = (
      (
        await call(t.admin, 'POST', '/knowledge/sources', {
          name: 'Rapports SAV',
          audience: ['user:usr_kofi'],
        })
      ).body.source as { sourceId: string }
    ).sourceId;
    expect(
      (
        await call(t.admin, 'POST', '/knowledge/sources', {
          name: 'Ouverte à tort',
          audience: ['anyone:x'],
        })
      ).status,
    ).toBe(422);
  });

  it('reads a document and indexes it, refusing what it cannot read', async () => {
    const doc = await call(t.admin, 'POST', `/knowledge/sources/${quality}/documents`, {
      name: 'Procédure NC v3.txt',
      contentType: 'text/plain',
      data: base64(
        'Toute réclamation client ouvre une fiche de non-conformité dans les 48 heures. L’action corrective est vérifiée sous 30 jours.',
      ),
    });
    expect(doc).toMatchObject({ status: 201, body: { chunks: 1, unchanged: false } });
    await call(t.admin, 'POST', `/knowledge/sources/${sav}/documents`, {
      name: 'Rapport de visite Agoè.txt',
      contentType: 'text/plain',
      data: base64(
        'Les batteries du site d’Agoè sont en fin de vie : deux à trois semaines d’autonomie.',
      ),
    });
    const zip = await call(t.admin, 'POST', `/knowledge/sources/${quality}/documents`, {
      name: 'a.zip',
      contentType: 'application/zip',
      data: base64('PK'),
    });
    expect(zip).toMatchObject({ status: 422, body: { error: 'unsupported_file' } });
    const listed = (await call(t.admin, 'GET', `/knowledge/sources/${quality}/documents`)).body
      .documents as { title: string }[];
    expect(listed.map((d) => d.title)).toEqual(['Procédure NC v3']);
  });

  it('finds passages with their citation, only in what each person may read', async () => {
    const kofi = (
      await call(
        t.kofi,
        'GET',
        `/knowledge/search?q=${encodeURIComponent('batteries Agoè autonomie')}`,
      )
    ).body.hits as { label: string; sourceName: string }[];
    expect(kofi[0]).toMatchObject({ label: 'Rapport de visite Agoè', sourceName: 'Rapports SAV' });
    const esi = (
      await call(
        t.esi,
        'GET',
        `/knowledge/search?q=${encodeURIComponent('batteries Agoè autonomie')}`,
      )
    ).body.hits as { sourceName: string }[];
    expect(esi.some((h) => h.sourceName === 'Rapports SAV')).toBe(false);
    const sources = (await call(t.esi, 'GET', '/knowledge/sources')).body;
    expect(sources).toMatchObject({ manage: false, sources: [{ name: 'Procédures qualité' }] });
  });

  it('hides a source switched off, and keeps its documents for when it comes back', async () => {
    await call(t.admin, 'POST', `/knowledge/sources/${sav}`, { enabled: false });
    const off = (
      await call(t.kofi, 'GET', `/knowledge/search?q=${encodeURIComponent('batteries Agoè')}`)
    ).body.hits as unknown[];
    expect(off.length === 0 || !JSON.stringify(off).includes('Rapports SAV')).toBe(true);
    await call(t.admin, 'POST', `/knowledge/sources/${sav}`, { enabled: true });
    const back = (
      await call(t.kofi, 'GET', `/knowledge/search?q=${encodeURIComponent('batteries Agoè')}`)
    ).body.hits as { sourceName: string }[];
    expect(back[0]?.sourceName).toBe('Rapports SAV');
  });

  it('gives the assistant the library, and its answer cites the document', async () => {
    let step = 0;
    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    };
    useModel(
      new MockLanguageModelV4({
        doStream: async () => {
          step += 1;
          const chunks: object[] =
            step === 1
              ? [
                  { type: 'stream-start', warnings: [] },
                  {
                    type: 'tool-call',
                    toolCallId: 'k1',
                    toolName: 'knowledge_search',
                    input: JSON.stringify({ query: 'réclamation client non-conformité' }),
                  },
                  {
                    type: 'finish',
                    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                    usage,
                  },
                ]
              : [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  {
                    type: 'text-delta',
                    id: 't1',
                    delta: 'Une fiche est ouverte sous 48 heures (Procédure NC v3).',
                  },
                  { type: 'text-end', id: 't1' },
                  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
                ];
          return { stream: simulateReadableStream({ chunks }) as never };
        },
      }),
    );
    const response = await api.request('/v1/assistant/chat/stream', {
      method: 'POST',
      headers: { authorization: `Bearer ${t.esi}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Que dit notre procédure sur une réclamation client ?' }),
    });
    const events = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Answer);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool', name: 'knowledge_search', state: 'done' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'source', label: 'Procédure NC v3' }),
    );
  });
});
