import { createHmac, randomBytes } from 'node:crypto';
import { memoryMailbox, memorySender } from '@kete/channels';
import { memoryChatChannel } from '@kete/notify';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { readMailboxes, useMailboxes, useRouterModel } from '../src/features/messages/index.js';
import { deliverPhones, usePhoneChannels } from '../src/features/phone/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 089 (doctrine D-056, D-057): what the outside says lands in its object's thread with a
// holder, never guessed. Abla heads the service; Kossi, her engineer, leads the project of the
// Hôtel du Golfe; the hotel writes on WhatsApp and by mail.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', yao: '' };
let key = 0;
const channel = memoryChatChannel('whatsapp');
const APP_SECRET = 'secret-of-the-number';
const inbox = memoryMailbox();
const sender = memorySender();
const ids = {} as Record<'party' | 'project' | 'thread', string>;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `messages-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

/** WhatsApp tells the center someone wrote to the organization's number, signed with its secret. */
async function whatsapp(from: string, id: string, text: string) {
  const raw = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '7007' },
              contacts: [{ wa_id: from, profile: { name: 'Réception' } }],
              messages: [{ from, id, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
  const response = await api.request('/public/chat/whatsapp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
    },
    body: raw,
  });
  expect(response.status).toBe(200);
}

const mail = (input: { id: string; from: string; to: string; subject: string; text: string }) =>
  [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: <${input.id}>`,
    'Date: Fri, 16 Oct 2026 09:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    input.text,
  ].join('\r\n');

type Thread = { id: string; holder: { id: string }; members: { kind: string; id: string }[] };
type Shown = { id: string; first: string; text: string; author: { id: string }; edits: number };
type Held = { holdingId: string; what: string; href: string; source: { kind: string } };
const pourMoi = async (token: string) =>
  (await get(token, '/pour-moi')).body as unknown as { held: Held[]; toAnswer: Held[] };

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY ??= randomBytes(32).toString('base64');
  db = await startApi();
  usePhoneChannels({ secretsKey: randomBytes(32).toString('base64'), connect: () => channel });
  useMailboxes({ mailbox: () => inbox, sender: () => sender });
  useRouterModel(null);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.abla = await tokenFor('usr_abla', { name: 'Abla Kpodar' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah' });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah' });
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
          phone: '+228 90 00 00 01',
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
  expect(
    (
      await post(t.admin, '/phone/senders', {
        channel: 'whatsapp',
        phoneNumberId: '7007',
        accessToken: 'token-of-the-number',
        appSecret: APP_SECRET,
      })
    ).status,
  ).toBe(200);
});

afterAll(async () => {
  usePhoneChannels({});
  useMailboxes(undefined);
  useRouterModel(undefined);
  await db?.drop();
});

describe('a client’s WhatsApp message', () => {
  it('lands in its project’s thread, held by its lead, in his « Pour moi » — and is answered', async () => {
    await whatsapp('22890000001', 'wamid.C1', 'La climatisation de la salle B ne refroidit plus.');
    const thread = (await get(t.kossi, `/threads/of/project/${ids.project}`)).body.thread as Thread;
    ids.thread = thread.id;
    expect(thread.holder.id).toBe('usr_kossi');
    const held = (await pourMoi(t.kossi)).held.find((h) => h.source.kind === 'message');
    expect(held).toMatchObject({
      what: 'La climatisation de la salle B ne refroidit plus.',
      href: `/fils/project/${ids.project}`,
    });
    await deliverPhones();
    expect(channel.sent.at(-1)).toMatchObject({
      to: '22890000001',
      text: 'Message reçu, merci. Nous revenons vers vous.',
    });
    // Delivered twice by WhatsApp: heard once.
    await whatsapp('22890000001', 'wamid.C1', 'La climatisation de la salle B ne refroidit plus.');
    const read = (await get(t.kossi, `/threads/${thread.id}`)).body.messages as Shown[];
    expect(read).toHaveLength(1);
  });

  it('is read by its members and the administrators only', async () => {
    expect((await get(t.yao, `/threads/${ids.thread}`)).status).toBe(403);
    expect((await get(t.admin, `/threads/${ids.thread}`)).status).toBe(200);
  });
});

describe('a sender nobody knows', () => {
  it('raises a card « à classer » for the head; settled, it lands and is learned', async () => {
    await whatsapp('22899999999', 'wamid.U1', 'Bonjour, je voudrais un devis pour des panneaux.');
    const card = (await pourMoi(t.abla)).held.find((h) => h.source.kind === 'triage');
    expect(card).toMatchObject({
      what: 'À classer : Bonjour, je voudrais un devis pour des panneaux.',
      href: '/fils/a-classer/whatsapp%3Awamid.U1',
    });
    expect(
      (
        await post(t.kossi, '/threads/triage/settle', {
          via: 'whatsapp',
          ref: 'wamid.U1',
          object: { kind: 'project', id: ids.project },
          intent: 'quote_request',
        })
      ).status,
    ).toBe(403);
    const settled = await post(t.abla, '/threads/triage/settle', {
      via: 'whatsapp',
      ref: 'wamid.U1',
      object: { kind: 'project', id: ids.project },
      intent: 'quote_request',
    });
    expect(settled.body.routing).toMatchObject({ by: 'person', thread: ids.thread });
    expect((await pourMoi(t.abla)).held.some((h) => h.source.kind === 'triage')).toBe(false);
    await whatsapp('22899999999', 'wamid.U2', 'Et pour la pose ?');
    const read = (await get(t.kossi, `/threads/${ids.thread}`)).body.messages as Shown[];
    expect(read.map((m) => m.text).slice(-2)).toEqual([
      'Bonjour, je voudrais un devis pour des panneaux.',
      'Et pour la pose ?',
    ]);
  });
});

describe('a person of the center on the number', () => {
  it('finds what she wrote in her thread « Kete »', async () => {
    await post(t.yao, '/phone', { channel: 'whatsapp', phone: '+228 90 55 66 77' });
    await whatsapp('22890556677', 'wamid.Y1', 'Penser à commander les filtres.');
    const kete = (await get(t.yao, '/threads/kete')).body.thread as Thread;
    const read = (await get(t.yao, `/threads/${kete.id}`)).body.messages as Shown[];
    expect(read).toMatchObject([{ text: 'Penser à commander les filtres.' }]);
  });
});

describe('the morning point (spec 090)', () => {
  it('is written in her thread « Kete », once a day, by Kete', async () => {
    expect((await get(t.yao, '/assistant/briefing')).status).toBe(200);
    expect((await post(t.yao, '/assistant/briefing')).status).toBe(201);
    const kete = (await get(t.yao, '/threads/kete')).body.thread as Thread;
    const read = (await get(t.yao, `/threads/${kete.id}`)).body as {
      messages: Shown[];
      names: Record<string, string>;
    };
    const points = read.messages.filter((m) => m.author.id === 'agt_briefing');
    expect(points).toHaveLength(1);
    expect(read.names.agt_briefing).toBe('Kete');
  });
});

describe('the mail bridged', () => {
  it('reads her mailbox, answers from her box in the conversation, and the reply comes back', async () => {
    const box = {
      userId: 'usr_kossi',
      address: 'kossi@kya.tg',
      name: 'Kossi Amegah',
      imapHost: 'mail.kya.tg',
      smtpHost: 'mail.kya.tg',
      login: 'kossi@kya.tg',
      password: 'mot-de-passe',
    };
    expect((await post(t.kossi, '/threads/mailboxes', box)).status).toBe(403);
    expect((await post(t.admin, '/threads/mailboxes', box)).status).toBe(201);
    const listed = (await get(t.admin, '/threads/mailboxes')).body.mailboxes as object[];
    expect(JSON.stringify(listed)).not.toContain('mot-de-passe');
    inbox.deliver(
      mail({
        id: 'h1@hotel-golfe.tg',
        from: 'Direction <direction@hotel-golfe.tg>',
        to: 'kossi@kya.tg',
        subject: 'Intervention',
        text: 'Pouvez-vous passer jeudi ?',
      }),
    );
    expect(await readMailboxes()).toBe(1);
    const answer = await post(t.kossi, `/threads/${ids.thread}/messages`, {
      text: 'Oui, jeudi à 10 h.',
    });
    expect(answer.body.mailed).toEqual(['direction@hotel-golfe.tg']);
    const sent = sender.sent.at(-1);
    expect(sent).toMatchObject({
      from: { address: 'kossi@kya.tg', name: 'Kossi Amegah' },
      subject: 'Climatisation Hôtel du Golfe',
      inReplyTo: '<h1@hotel-golfe.tg>',
    });
    expect(inbox.sent).toHaveLength(1);
    // Her reply, from the client the center knows, comes back into the project's thread.
    inbox.deliver(
      mail({
        id: 'h2@hotel-golfe.tg',
        from: 'direction@hotel-golfe.tg',
        to: 'kossi@kya.tg',
        subject: 'Re: Climatisation Hôtel du Golfe',
        text: 'Parfait, merci.',
      }),
    );
    expect(await readMailboxes()).toBe(1);
    const read = (await get(t.kossi, `/threads/${ids.thread}`)).body.messages as Shown[];
    expect(read.at(-1)).toMatchObject({
      text: 'Re: Climatisation Hôtel du Golfe\n\nParfait, merci.',
      author: { id: 'mail:direction@hotel-golfe.tg' },
    });
  });
});

describe('the trace', () => {
  it('keeps the original of an edit, and exports the journal with its fingerprint', async () => {
    const posted = await post(t.kossi, `/threads/${ids.thread}/messages`, {
      text: 'Technicien en route',
      for: 'action',
      to: { kind: 'person', id: 'usr_yao' },
      byMail: false,
    });
    const message = posted.body.message as { id: string };
    expect(posted.body.holdingId).toEqual(expect.stringMatching(/^hld_/));
    expect(
      (await post(t.abla, `/threads/messages/${message.id}/edit`, { text: 'Autre' })).status,
    ).toBe(403);
    await post(t.kossi, `/threads/messages/${message.id}/edit`, {
      text: 'Technicien en route, arrivée 10 h',
    });
    const read = (await get(t.yao, `/threads/${ids.thread}`)).body.messages as Shown[];
    expect(read.at(-1)).toMatchObject({ first: message.id, edits: 1 });
    const proof = (await get(t.kossi, `/threads/${ids.thread}/export`)).body as {
      fingerprint: string;
      journal: { messages: { text: string }[] };
    };
    expect(proof.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.journal.messages.map((m) => m.text)).toContain('Technicien en route');
    // Her own thread « Kete » is hers: Abla, no member of it, does not find it.
    expect((await get(t.yao, '/threads/search?q=filtres')).body.messages).toHaveLength(1);
    expect((await get(t.abla, '/threads/search?q=filtres')).body.messages).toEqual([]);
  });
});
