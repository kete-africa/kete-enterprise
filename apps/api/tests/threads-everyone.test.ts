import { randomBytes } from 'node:crypto';
import { memoryMailbox, memorySender } from '@kete/channels';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryStorage } from '@kete/files';
import { createApi } from '../src/app.js';
import { ringUnread, useMailboxes, useRouterModel } from '../src/features/messages/index.js';
import { usePushSender } from '../src/features/notifications/index.js';
import { useFileStorage } from '../src/platform/storage.js';
import { startApi, tokenFor } from './support.js';

// Spec 099: the enterprise talks here — the threads at today's level, at the center. Abla heads
// after-sales; Kossi, her engineer, leads the Hôtel du Golfe's project; Yao is a technician.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', yao: '', essi: '' };
let key = 0;
const ids = {} as Record<'party' | 'project' | 'thread' | 'group', string>;
const sender = memorySender();

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `everyone-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: Answer = {};
  try {
    parsed = JSON.parse(text) as Answer;
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed, response };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type Summary = { thread: { id: string; kind: string; title: string }; unread: number };
const list = async (token: string) =>
  (await get(token, '/threads')).body as unknown as {
    threads: Summary[];
    names: Record<string, string>;
  };
const say = (token: string, threadId: string, body: object) =>
  post(token, `/threads/${threadId}/messages`, body);

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY ??= randomBytes(32).toString('base64');
  db = await startApi();
  useFileStorage(memoryStorage());
  usePushSender(null);
  useMailboxes({ mailbox: () => memoryMailbox(), sender: () => sender });
  useRouterModel(null);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.abla = await tokenFor('usr_abla', { name: 'Abla Kpodar' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah' });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah' });
  t.essi = await tokenFor('usr_essi', { name: 'Essi Lawson' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Service après-vente',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  const position = async (title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
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
  const head = await position('Responsable SAV');
  await assign('Abla Kpodar', 'usr_abla', head);
  await assign('Kossi Amegah', 'usr_kossi', await position('Ingénieur', head));
  await assign('Yao Mensah', 'usr_yao', await position('Technicien', head));
  await assign('Essi Lawson', 'usr_essi', await position('Comptable', head));
  const roleId = (
    await post(t.admin, '/rights/roles', {
      name: 'Projets',
      permissions: ['projects:manage', 'parties:manage'],
    })
  ).body.roleId;
  await post(t.admin, '/rights/grants', { roleId, positionId: head, startsOn: '2026-01-01' });
  await post(t.admin, '/organization/modules', { module: 'dossiers', enabled: true });
  ids.party = String(
    (
      (
        await post(t.abla, '/parties', {
          name: 'Hôtel du Golfe',
          roles: ['client'],
          email: 'direction@hotel-golfe.tg',
        })
      ).body.party as { partyId: string }
    ).partyId,
  );
  ids.project = String(
    (
      (
        await post(t.abla, '/projects', {
          name: 'Climatisation Hôtel du Golfe',
          partyId: ids.party,
          lead: { userId: 'usr_kossi', name: 'Kossi Amegah' },
        })
      ).body.project as { projectId: string }
    ).projectId,
  );
});

afterAll(async () => {
  useFileStorage(undefined);
  usePushSender(undefined);
  useMailboxes(undefined);
  useRouterModel(undefined);
  await db?.drop();
});

type Shown = {
  id: string;
  first: string;
  text: string;
  reactions: { emoji: string; by: { id: string }[] }[];
  pinned?: unknown;
  deleted?: unknown;
  attachments?: { id: string; media_type?: string; duration_ms?: number }[];
  references?: { kind: string; id: string }[];
};

const threadOfProject = async () => {
  const kossi = await list(t.kossi);
  return (
    kossi.threads.find((s) => s.thread.title === 'Climatisation Hôtel du Golfe')?.thread.id ?? ''
  );
};

describe('the conversation (FR-001)', () => {
  it('opens where she stopped, and takes reactions, pins and a message taken back', async () => {
    ids.thread = await threadOfProject();
    const first = (await say(t.abla, ids.thread, { text: 'Le devis est validé.' })).body
      .message as Shown;
    await say(t.abla, ids.thread, { text: 'La pose commence lundi.' });
    const opened = (await get(t.kossi, `/threads/${ids.thread}`)).body as {
      unreadFrom: string | null;
      older: boolean;
      level: string;
    };
    expect(opened.unreadFrom).toBe(first.id);
    expect(opened.older).toBe(false);
    expect(opened.level).toBe('all');

    expect(
      (await post(t.kossi, `/threads/messages/${first.id}/react`, { emoji: '👍' })).status,
    ).toBe(200);
    expect((await post(t.yao, `/threads/messages/${first.id}/react`, { emoji: '👍' })).status).toBe(
      403,
    );
    expect(
      (await post(t.kossi, `/threads/messages/${first.id}/pin`, { pinned: true })).status,
    ).toBe(200);
    expect((await post(t.kossi, `/threads/messages/${first.id}/delete`)).status).toBe(403);
    const page = (await get(t.abla, `/threads/${ids.thread}/page`)).body as { messages: Shown[] };
    const shown = page.messages.find((m) => m.first === first.id);
    expect(shown?.reactions).toEqual([{ emoji: '👍', by: [{ kind: 'person', id: 'usr_kossi' }] }]);
    expect(shown?.pinned).toBeTruthy();
    expect((await post(t.abla, `/threads/messages/${first.id}/delete`)).status).toBe(200);
    const after = (await get(t.kossi, `/threads/${ids.thread}/page`)).body as { messages: Shown[] };
    expect(after.messages.find((m) => m.first === first.id)).toMatchObject({
      text: '',
      deleted: {},
    });
  });

  it('cites an object with « # », in its state of now, and finds it to cite', async () => {
    const found = (await get(t.kossi, '/threads/objects?q=Climatisation')).body as {
      objects: { kind: string; id: string; label: string }[];
    };
    expect(found.objects).toContainEqual(
      expect.objectContaining({
        kind: 'project',
        id: ids.project,
        label: 'Climatisation Hôtel du Golfe',
      }),
    );
    await say(t.kossi, ids.thread, {
      text: 'Voir #Climatisation',
      references: [{ kind: 'project', id: ids.project }],
    });
    const opened = (await get(t.kossi, `/threads/${ids.thread}`)).body as {
      cited: Record<string, { label: string; state: string | null }>;
    };
    expect(opened.cited[`project:${ids.project}`]).toEqual({
      label: 'Climatisation Hôtel du Golfe',
      state: 'open',
    });
  });

  it('keeps a voice note in the storage, and serves it to the members only', async () => {
    const audio = Buffer.from('OggS-voice-note').toString('base64');
    const posted = await post(t.kossi, `/threads/${ids.thread}/voice`, {
      data: audio,
      contentType: 'audio/ogg',
      durationMs: 4200,
    });
    expect(posted.status).toBe(201);
    const message = posted.body.message as Shown;
    expect(message.attachments?.[0]).toMatchObject({ media_type: 'audio/ogg', duration_ms: 4200 });
    const file = message.attachments?.[0]?.id ?? '';
    const served = await call(t.abla, 'GET', `/threads/files/${file}`);
    expect(served.status).toBe(200);
    expect((await call(t.essi, 'GET', `/threads/files/${file}`)).status).toBe(403);
    const media = (await get(t.abla, `/threads/${ids.thread}/media`)).body as {
      media: { voices: unknown[]; pins: unknown[] };
      level: string;
    };
    expect(media.media.voices).toHaveLength(1);

    // A photo kept in the storage, then attached to a message: it stays attached.
    const photo = await post(t.kossi, `/threads/${ids.thread}/files`, {
      name: 'chantier.jpg',
      contentType: 'image/jpeg',
      data: Buffer.from('jpeg-bytes').toString('base64'),
    });
    expect(photo.status).toBe(201);
    const photoId = (photo.body.file as { id: string }).id;
    const withPhoto = (await say(t.kossi, ids.thread, { text: 'La pose', files: [photoId] })).body
      .message as Shown;
    expect(withPhoto.attachments?.map((a) => a.id)).toEqual([photoId]);
  });

  it('sets her notification level, and rings a phone only after three minutes', async () => {
    expect((await post(t.yao, `/threads/${ids.thread}/notify`, { level: 'none' })).status).toBe(
      403,
    );
    expect(
      (await post(t.kossi, `/threads/${ids.thread}/notify`, { level: 'mentions' })).status,
    ).toBe(200);
    const said = (
      await say(t.abla, ids.thread, {
        text: 'Kossi, le client a rappelé.',
        for: 'action',
        to: { kind: 'person', id: 'usr_kossi' },
      })
    ).body.message as Shown;
    await ringUnread();
    const fresh = await db.owner.query(
      `select user_id from ${db.schema}.thread_pushes where message_id = $1`,
      [said.id],
    );
    expect(fresh.rows).toEqual([]);
    await db.owner.query(
      `update ${db.schema}.kete_messages set at = now() - interval '5 minutes' where message_id = $1`,
      [said.id],
    );
    await ringUnread();
    const rung = await db.owner.query(
      `select user_id from ${db.schema}.thread_pushes where message_id = $1`,
      [said.id],
    );
    expect(rung.rows).toEqual([{ user_id: 'usr_kossi' }]);
  });
});

describe('other conversations (FR-019)', () => {
  it('imports a WhatsApp export once, recognizing who it can, and merges a thread', async () => {
    const exported = [
      '20/10/2026 09:15 - Kossi Amegah: Les splits arrivent jeudi',
      '20/10/2026 09:16 - +228 90 00 00 99: Merci',
    ].join('\n');
    const data = Buffer.from(exported).toString('base64');
    const first = await post(t.kossi, `/threads/${ids.thread}/import`, { kind: 'whatsapp', data });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      imported: 2,
      skipped: 0,
      recognized: 1,
      unknown: ['+228 90 00 00 99'],
    });
    const again = await post(t.kossi, `/threads/${ids.thread}/import`, { kind: 'whatsapp', data });
    expect(again.body).toMatchObject({ imported: 0, skipped: 2 });

    const group = (
      await post(t.abla, '/threads', { kind: 'group', title: 'Chantier Golfe (WhatsApp)' })
    ).body.thread as { id: string };
    await say(t.abla, group.id, { text: 'Bienvenue' });
    expect((await post(t.kossi, `/threads/${group.id}/merge`, { into: ids.thread })).status).toBe(
      403,
    );
    const merged = await post(t.abla, `/threads/${group.id}/merge`, { into: ids.thread });
    expect(merged.body).toEqual({ moved: 1 });
  });
});
