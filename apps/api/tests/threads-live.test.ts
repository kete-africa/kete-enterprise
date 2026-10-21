import { randomBytes } from 'node:crypto';
import { memoryMailbox, memorySender } from '@kete/channels';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useMailboxes, useRouterModel } from '../src/features/messages/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 098: threads people live in, at the center. Abla heads after-sales; Kossi, her engineer,
// leads the Hôtel du Golfe's project; Yao is a technician; Essi belongs to another team.

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
      'idempotency-key': `live-key-${++key}`,
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
type View = {
  thread: { id: string; members: { kind: string; id: string; until?: string }[] };
  messages: { id: string; first: string; text: string; readBy: unknown[]; movedTo?: unknown }[];
  actions: Record<
    string,
    { holdingId: string; due: string | null; priority: string; state: string }
  >;
  pending: Record<string, { state: string; approvers: string[] }>;
  files: { name: string; versions: { id: string }[] }[];
  names: Record<string, string>;
  link: string | null;
};
const list = async (token: string) =>
  (await get(token, '/threads')).body as unknown as {
    threads: Summary[];
    names: Record<string, string>;
  };
const view = async (token: string, id: string) =>
  (await get(token, `/threads/${id}`)).body as unknown as View;
const say = (token: string, threadId: string, body: object) =>
  post(token, `/threads/${threadId}/messages`, body);

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY ??= randomBytes(32).toString('base64');
  db = await startApi();
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
  useMailboxes(undefined);
  useRouterModel(undefined);
  await db?.drop();
});

describe('a thread born with its object (FR-010)', () => {
  it('opens with a project and a third party, held by their lead and their creator', async () => {
    const kossi = await list(t.kossi);
    const project = kossi.threads.find((s) => s.thread.title === 'Climatisation Hôtel du Golfe');
    expect(project?.thread.kind).toBe('object');
    ids.thread = project?.thread.id ?? '';
    const abla = await list(t.abla);
    expect(abla.threads.map((s) => s.thread.title)).toEqual(
      expect.arrayContaining(['Hôtel du Golfe', 'Climatisation Hôtel du Golfe']),
    );
    expect((await view(t.kossi, ids.thread)).link).toBe(`/projets/${ids.project}`);
  });

  it('names people, never by an identifier (FR-002)', async () => {
    const seen = await view(t.kossi, ids.thread);
    expect(seen.names.usr_kossi).toBe('Kossi Amegah');
    expect(Object.values(seen.names).some((n) => n.startsWith('usr_'))).toBe(false);
  });
});

describe('unread, mentions and actions (FR-003, FR-007, FR-014)', () => {
  it('counts what she has not read, and her own words are read', async () => {
    await say(t.abla, ids.thread, { text: 'Le client relance pour la date.' });
    let kossi = (await list(t.kossi)).threads.find((s) => s.thread.id === ids.thread);
    expect(kossi?.unread).toBe(1);
    expect((await list(t.abla)).threads.find((s) => s.thread.id === ids.thread)?.unread).toBe(0);
    await view(t.kossi, ids.thread);
    kossi = (await list(t.kossi)).threads.find((s) => s.thread.id === ids.thread);
    expect(kossi?.unread).toBe(0);
  });

  it('makes a mentioned person a member and tells her', async () => {
    const answer = await say(t.kossi, ids.thread, {
      text: '@Yao Mensah peux-tu préparer le matériel ?',
      mentions: [{ kind: 'person', id: 'usr_yao' }],
    });
    expect(answer.status).toBe(201);
    expect((await list(t.yao)).threads.some((s) => s.thread.id === ids.thread)).toBe(true);
    const told = (await get(t.yao, '/notifications')).body.notifications as { kind: string }[];
    expect(told.some((n) => n.kind === 'thread.mentioned')).toBe(true);
  });

  it('gives an action its holder, due day and priority; only its holder says it is done', async () => {
    const asked = await say(t.kossi, ids.thread, {
      text: 'Commander deux compresseurs.',
      for: 'action',
      to: { kind: 'person', id: 'usr_yao' },
      due: '2026-10-30',
      priority: 'urgent',
    });
    const holdingId = String(asked.body.holdingId);
    const seen = await view(t.yao, ids.thread);
    const action = Object.values(seen.actions).find((a) => a.holdingId === holdingId);
    expect(action).toMatchObject({ due: '2026-10-30', priority: 'urgent', state: 'held' });
    expect((await post(t.essi, `/threads/actions/${holdingId}/done`)).status).toBe(403);
    expect((await post(t.yao, `/threads/actions/${holdingId}/done`)).status).toBe(200);
  });
});

describe('members, files and moves (FR-006, FR-008)', () => {
  it('lets its holder add and remove members, nobody else', async () => {
    expect(
      (
        await post(t.yao, `/threads/${ids.thread}/members`, {
          add: [{ kind: 'person', id: 'usr_essi' }],
        })
      ).status,
    ).toBe(403);
    await post(t.kossi, `/threads/${ids.thread}/members`, {
      add: [{ kind: 'person', id: 'usr_essi' }],
    });
    expect((await list(t.essi)).threads.some((s) => s.thread.id === ids.thread)).toBe(true);
    await post(t.kossi, `/threads/${ids.thread}/members`, {
      remove: [{ kind: 'person', id: 'usr_essi' }],
    });
    expect((await list(t.essi)).threads.some((s) => s.thread.id === ids.thread)).toBe(false);
  });

  it('keeps a file and its versions, for the thread’s members only', async () => {
    const send = (text: string) =>
      post(t.kossi, `/threads/${ids.thread}/files`, {
        name: 'Fiche technique.txt',
        contentType: 'text/plain',
        data: Buffer.from(text).toString('base64'),
      });
    const first = (await send('v1')).body.file as { id: string; version: number };
    const second = (await send('v2')).body.file as { id: string; version: number };
    expect([first.version, second.version]).toEqual([1, 2]);
    const seen = await view(t.kossi, ids.thread);
    expect(seen.files[0]).toMatchObject({ name: 'Fiche technique.txt' });
    expect(seen.files[0]?.versions.map((v) => v.id)).toEqual([second.id, first.id]);
    const read = await api.request(`/v1/threads/files/${first.id}`, {
      headers: { authorization: `Bearer ${t.yao}` },
    });
    expect(await read.text()).toBe('v1');
    const refused = await api.request(`/v1/threads/files/${first.id}`, {
      headers: { authorization: `Bearer ${t.essi}` },
    });
    expect(refused.status).toBe(403);
  });

  it('moves a message to another of her threads, the original saying where it went', async () => {
    const group = await post(t.kossi, '/threads', {
      kind: 'group',
      title: 'Achats SAV',
      members: [{ kind: 'person', id: 'usr_yao' }],
    });
    ids.group = String((group.body.thread as { id: string }).id);
    const said = await say(t.kossi, ids.thread, { text: 'Le fournisseur livre lundi.' });
    const id = String((said.body.message as { id: string }).id);
    expect((await post(t.kossi, `/threads/messages/${id}/move`, { to: ids.group })).status).toBe(
      200,
    );
    const source = await view(t.kossi, ids.thread);
    expect(source.messages.find((m) => m.first === id)?.movedTo).toBeTruthy();
    const target = await view(t.kossi, ids.group);
    expect(target.messages.at(-1)?.text).toBe('Le fournisseur livre lundi.');
  });
});

describe('who speaks for the company (FR-015)', () => {
  it('needs an approval when a policy asks one, and leaves once approved', async () => {
    // An app's object, with its third party: the client's mail joins the thread.
    const opened = await post(t.kossi, '/apps/prd_kete_helpdesk/threads', {
      kind: 'ticket',
      id: 'tkt_golfe_1',
      title: 'Ticket — clim en panne',
      href: 'https://support.kya.test/tickets/tkt_golfe_1',
      party: ids.party,
    });
    expect(opened.status).toBe(201);
    const threadId = String(opened.body.threadId);
    const ticket = await view(t.kossi, threadId);
    expect(ticket.link).toBe('https://support.kya.test/tickets/tkt_golfe_1');
    expect(ticket.thread.members.some((m) => m.id === 'mail:direction@hotel-golfe.tg')).toBe(true);
    // Without a policy, a note stays inside and words to the client leave.
    const internal = await say(t.kossi, threadId, { text: 'Pièce commandée.' });
    expect(internal.body.delivered).toBeNull();
    const policy = await post(t.admin, '/policies', {
      id: 'clients.approval',
      sentence: 'Écrire au client demande l’accord du responsable',
      rule: 'permit (principal, action == Kete::Action::"message.client", resource);',
      set: 'approval',
      approver: 'manager',
    });
    expect(policy.status).toBe(201);
    await post(t.admin, '/policies/clients.approval/status', { status: 'active' });
    const asked = await say(t.kossi, threadId, {
      text: 'Nous passons jeudi à 10 h.',
      visibility: 'outside',
    });
    expect(asked.status).toBe(201);
    expect(asked.body.waiting).toEqual(['usr_abla']);
    const id = String((asked.body.message as { id: string }).id);
    expect((await view(t.kossi, threadId)).pending[id]?.state).toBe('waiting');
    expect((await post(t.yao, `/threads/messages/${id}/outside`, { approve: true })).status).toBe(
      404,
    );
    const decided = await post(t.abla, `/threads/messages/${id}/outside`, { approve: true });
    expect(decided.body.state).toBe('sent');
    expect((await view(t.kossi, threadId)).pending[id]?.state).toBe('sent');
  });
});

describe('her days in Outlook (FR-018)', () => {
  it('serves her facts under a secret address, closed when renewed', async () => {
    await post(t.kossi, '/time/facts', {
      source: 'kete-team',
      fact: {
        key: 'visite-golfe',
        kind: 'meeting',
        label: 'Visite Hôtel du Golfe',
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        person_ids: ['usr_kossi'],
      },
    });
    const made = await post(t.kossi, '/time/feed');
    const address = String(made.body.address);
    const path = new URL(address).pathname;
    const feed = await api.request(path);
    expect(feed.headers.get('content-type')).toContain('text/calendar');
    expect(await feed.text()).toContain('Visite Hôtel du Golfe');
    await post(t.kossi, '/time/feed');
    expect((await api.request(path)).status).toBe(404);
  });
});

describe('the six policies in forms (FR-019)', () => {
  it('lists the templates the center accepts, and simulates one over 30 days', async () => {
    const templates = (await get(t.admin, '/policies/templates')).body.templates as {
      id: string;
    }[];
    expect(templates.map((x) => x.id)).toEqual(expect.arrayContaining(['speaks.channels']));
    const seen = await post(t.admin, '/policies/templates/speaks.channels', {
      channels: ['whatsapp'],
    });
    expect(seen.status).toBe(200);
    expect(seen.body.policy).toMatchObject({ status: 'trial' });
    expect((seen.body.simulation as { replayed: number }).replayed).toBeGreaterThan(0);
  });
});

describe('« Pour moi » (FR-017)', () => {
  it('lets her set a priority and put a holding off until tomorrow', async () => {
    const asked = await say(t.abla, ids.thread, {
      text: 'Relancer le fournisseur.',
      for: 'action',
      to: { kind: 'person', id: 'usr_kossi' },
    });
    const holdingId = String(asked.body.holdingId);
    expect(
      (await post(t.kossi, `/pour-moi/${holdingId}/priorite`, { priority: 'high' })).status,
    ).toBe(200);
    expect((await post(t.yao, `/pour-moi/${holdingId}/priorite`, { priority: 'low' })).status).toBe(
      403,
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await post(t.kossi, `/pour-moi/${holdingId}/reporter`, { until: tomorrow });
    const held = (await get(t.kossi, '/pour-moi')).body.held as { holdingId: string }[];
    expect(held.some((h) => h.holdingId === holdingId)).toBe(false);
  });
});
