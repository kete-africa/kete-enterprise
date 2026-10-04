import type { Embedder } from '@kete/knowledge';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useEmbedder } from '../src/features/knowledge/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 034: one space per subject, shared by its members — its documents read by them only,
// what it gathers from the rest of Kete Enterprise by reference.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '', esi: '' };
let key = 0;

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
      'idempotency-key': `dossier-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

beforeAll(async () => {
  db = await startApi();
  useEmbedder(fake);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
});

afterAll(async () => {
  useEmbedder(undefined);
  await db?.drop();
});

describe('dossiers', () => {
  let dossier = '';

  it('answer only when their module is on', async () => {
    expect((await call(t.ama, 'GET', '/dossiers')).body).toMatchObject({
      error: 'module_disabled',
    });
    await call(t.admin, 'POST', '/organization/modules', { module: 'dossiers', enabled: true });
    await call(t.admin, 'POST', '/organization/modules', { module: 'knowledge', enabled: true });
  });

  it('opens a dossier that its creator owns, and adds its members', async () => {
    const created = await call(t.ama, 'POST', '/dossiers', {
      name: 'Audit ISO 9001 · 2026',
      description: 'Audit externe le 30 novembre',
    });
    expect(created).toMatchObject({
      status: 201,
      body: { dossier: { name: 'Audit ISO 9001 · 2026', role: 'owner', members: 1 } },
    });
    dossier = (created.body.dossier as { dossierId: string }).dossierId;
    expect(
      (
        await call(t.kofi, 'POST', `/dossiers/${dossier}/members`, {
          userId: 'usr_esi',
          name: 'Esi',
        })
      ).status,
    ).toBe(404);
    const members = await call(t.ama, 'POST', `/dossiers/${dossier}/members`, {
      userId: 'usr_kofi',
      name: 'Kofi Mensah',
    });
    expect((members.body.members as { name: string }[]).map((m) => m.name)).toEqual([
      'Ama Agbeko',
      'Kofi Mensah',
    ]);
    expect((await call(t.kofi, 'GET', '/dossiers')).body).toMatchObject({
      dossiers: [{ name: 'Audit ISO 9001 · 2026', role: 'member' }],
    });
    expect((await call(t.esi, 'GET', '/dossiers')).body).toEqual({ dossiers: [] });
    expect((await call(t.esi, 'GET', `/dossiers/${dossier}`)).status).toBe(404);
  });

  it('keeps its documents for its members only, in its search and in the library', async () => {
    const doc = await call(t.kofi, 'POST', `/dossiers/${dossier}/documents`, {
      name: 'Rapport audit interne.txt',
      contentType: 'text/plain',
      data: base64('Écart clause 8.5 : la maîtrise de la prestation de service n’est pas tracée.'),
    });
    expect(doc).toMatchObject({ status: 201, body: { chunks: 1 } });
    const inside = (
      await call(
        t.ama,
        'GET',
        `/dossiers/${dossier}/search?q=${encodeURIComponent('écart clause 8.5')}`,
      )
    ).body.hits as { label: string }[];
    expect(inside[0]?.label).toBe('Rapport audit interne');
    const library = (
      await call(t.kofi, 'GET', `/knowledge/search?q=${encodeURIComponent('écart clause 8.5')}`)
    ).body.hits as { title: string }[];
    expect(library[0]?.title).toBe('Rapport audit interne');
    const outsider = (
      await call(t.esi, 'GET', `/knowledge/search?q=${encodeURIComponent('écart clause 8.5')}`)
    ).body.hits as unknown[];
    expect(outsider).toEqual([]);
    expect((await call(t.esi, 'GET', `/dossiers/${dossier}/search?q=ecart`)).status).toBe(404);
  });

  it('gathers what it needs by reference, a conversation only from its own author', async () => {
    await db.owner.query(
      `insert into ${db.schema}.assistant_conversations (conversation_id, organization_id, user_id, title)
       values ('cnv_00000000-0000-0000-0000-0000000000aa', 'org_kya', 'usr_ama', 'Préparer l’audit')`,
    );
    const conversation = {
      kind: 'conversation',
      ref: 'cnv_00000000-0000-0000-0000-0000000000aa',
      title: 'Préparer l’audit',
      href: '/assistant?c=cnv_00000000-0000-0000-0000-0000000000aa',
    };
    expect((await call(t.kofi, 'POST', `/dossiers/${dossier}/links`, conversation)).status).toBe(
      403,
    );
    expect((await call(t.ama, 'POST', `/dossiers/${dossier}/links`, conversation)).status).toBe(
      201,
    );
    await call(t.kofi, 'POST', `/dossiers/${dossier}/links`, {
      kind: 'url',
      ref: 'norme',
      title: 'Norme ISO 9001:2015',
      href: 'https://www.iso.org/standard/62085.html',
    });
    const read = await call(t.kofi, 'GET', `/dossiers/${dossier}`);
    expect((read.body.links as { title: string }[]).map((l) => l.title).sort()).toEqual([
      'Norme ISO 9001:2015',
      'Préparer l’audit',
    ]);
    expect(
      (
        await call(
          t.kofi,
          'GET',
          `/dossiers/${dossier}/conversations/cnv_00000000-0000-0000-0000-0000000000aa`,
        )
      ).body,
    ).toMatchObject({ title: 'Préparer l’audit' });
    expect(
      (
        await call(
          t.esi,
          'GET',
          `/dossiers/${dossier}/conversations/cnv_00000000-0000-0000-0000-0000000000aa`,
        )
      ).status,
    ).toBe(404);
  });

  it('is archived by its owner, and a member may leave', async () => {
    expect((await call(t.kofi, 'POST', `/dossiers/${dossier}`, { archived: true })).status).toBe(
      403,
    );
    expect(
      (await call(t.ama, 'POST', `/dossiers/${dossier}`, { archived: true })).body,
    ).toMatchObject({ dossier: { archived: true } });
    expect(
      (await call(t.kofi, 'POST', `/dossiers/${dossier}/members/usr_kofi/remove`, {})).status,
    ).toBe(200);
    expect((await call(t.kofi, 'GET', '/dossiers')).body).toEqual({ dossiers: [] });
  });
});
