import type { Embedder } from '@kete/knowledge';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useEmbedder } from '../src/features/knowledge/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 064: a cited passage opens its document at its page, the passage marked — only for whom
// the document is open; a file of a conversation opens again for its owner, never for another.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '', esi: '' };
let key = 0;
let documentId = '';

const fake: Embedder = {
  dimensions: 1536,
  async embed(texts) {
    return texts.map((text) => {
      const v = new Array<number>(1536).fill(0);
      for (const word of text.toLowerCase().split(/\W+/)) {
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
      'idempotency-key': `pieces-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Answer, raw: response };
}
const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
// A 1×1 PNG.
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(async () => {
  db = await startApi();
  useEmbedder(fake);
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
  await call(t.admin, 'POST', '/organization/modules', { module: 'knowledge', enabled: true });
  const source = (
    await call(t.admin, 'POST', '/knowledge/sources', {
      name: 'Rapports SAV',
      audience: ['user:usr_kofi'],
    })
  ).body.source as { sourceId: string };
  const indexed = await call(t.admin, 'POST', `/knowledge/sources/${source.sourceId}/documents`, {
    name: 'Rapport de visite Agoè.txt',
    contentType: 'text/plain',
    data: base64(
      'Visite du site d’Agoè le 3 octobre. Les batteries du site sont en fin de vie : deux à trois semaines d’autonomie. Prévoir leur remplacement avant la fin du mois.',
    ),
  });
  expect(indexed.status).toBe(201);
});

afterAll(async () => {
  useEmbedder(undefined);
  await db?.drop();
});

describe('a cited passage', () => {
  it('opens its document in the library, at its page, the passage marked', async () => {
    const hits = (
      await call(t.kofi, 'GET', `/knowledge/search?q=${encodeURIComponent('batteries autonomie')}`)
    ).body.hits as { href: string; documentId: string; text: string }[];
    const hit = hits[0];
    expect(hit?.href).toMatch(/^\/bibliotheque\/document\/[^?]+\?(page=\d+&)?passage=\d+$/);
    documentId = hit?.documentId ?? '';
    const passage = Number(new URL(hit?.href ?? '', 'https://x.test').searchParams.get('passage'));
    const reading = (await call(t.kofi, 'GET', `/knowledge/documents/${documentId}`)).body
      .document as {
      title: string;
      sourceName: string;
      pages: { passages: { passage: number; text: string }[] }[];
    };
    expect(reading).toMatchObject({ title: 'Rapport de visite Agoè', sourceName: 'Rapports SAV' });
    const marked = reading.pages
      .flatMap((page) => page.passages)
      .find((p) => p.passage === passage);
    expect(marked?.text).toBe(hit?.text);
  });

  it('is not open to whom the document is not', async () => {
    expect((await call(t.esi, 'GET', `/knowledge/documents/${documentId}`)).status).toBe(404);
    // An administrator reads every document.
    expect((await call(t.admin, 'GET', `/knowledge/documents/${documentId}`)).status).toBe(200);
  });
});

describe('a file of a conversation', () => {
  it('opens again for its owner, with what was read in it, and its bytes when kept', async () => {
    const text = await call(t.kofi, 'POST', '/assistant/attachments', {
      name: 'releve-sept.txt',
      contentType: 'text/plain',
      data: base64('Garage Bè doit 310 000 F CFA depuis 42 jours.'),
    });
    const textId = (text.body as { attachmentId: string }).attachmentId;
    expect((await call(t.kofi, 'GET', `/assistant/attachments/${textId}`)).body).toMatchObject({
      attachment: {
        name: 'releve-sept.txt',
        kind: 'text',
        text: 'Garage Bè doit 310 000 F CFA depuis 42 jours.',
        hasFile: false,
      },
    });
    const image = await call(t.kofi, 'POST', '/assistant/attachments', {
      name: 'photo-facture.png',
      contentType: 'image/png',
      data: pixel,
    });
    const imageId = (image.body as { attachmentId: string }).attachmentId;
    const file = await api.request(`/v1/assistant/attachments/${imageId}/file`, {
      headers: { authorization: `Bearer ${t.kofi}` },
    });
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).toString('base64')).toBe(pixel);
  });

  it('is nobody else’s', async () => {
    const mine = await call(t.kofi, 'POST', '/assistant/attachments', {
      name: 'note.txt',
      contentType: 'text/plain',
      data: base64('Rien à voir.'),
    });
    const id = (mine.body as { attachmentId: string }).attachmentId;
    expect((await call(t.esi, 'GET', `/assistant/attachments/${id}`)).status).toBe(404);
    expect((await call(t.esi, 'GET', `/assistant/attachments/${id}/file`)).status).toBe(404);
  });
});
