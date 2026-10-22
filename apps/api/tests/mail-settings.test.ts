import { randomBytes } from 'node:crypto';
import { memoryMailbox, memorySender } from '@kete/channels';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryStorage } from '@kete/files';
import { createApi } from '../src/app.js';
import { readMailboxes, useMailboxes, useRouterModel } from '../src/features/messages/index.js';
import { usePushSender } from '../src/features/notifications/index.js';
import { useFileStorage } from '../src/platform/storage.js';
import { startApi, tokenFor } from './support.js';

// Spec 099, FR-018: mail as decided. Kossi's box is personal: Kete reads only what touches the
// organization's objects — the Hôtel du Golfe, a client the center knows —, the « Kete » folder he
// drops a mail in, and his Sent folder by the same rule; never the rest. The reception's box is
// shared: read whole. Each routing step is counted; a mail shows cleaned, its original kept.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', yao: '', essi: '' };
let key = 0;
const ids = {} as Record<'party' | 'project' | 'thread' | 'group', string>;
const sender = memorySender();
const kossiBox = memoryMailbox();
const desk = memoryMailbox();

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `mail-key-${++key}`,
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
  useMailboxes({
    mailbox: (account) => (account.userId === 'usr_kossi' ? kossiBox : desk),
    sender: () => sender,
  });
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

const mail = (input: {
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
}) =>
  [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: <${input.id}>`,
    ...(input.inReplyTo ? [`In-Reply-To: <${input.inReplyTo}>`] : []),
    'Date: Fri, 23 Oct 2026 09:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    input.text,
  ].join('\r\n');

const box = (userId: string, address: string) => ({
  userId,
  address,
  imapHost: 'mail.kya.tg',
  smtpHost: 'mail.kya.tg',
  login: address,
  password: 'mot-de-passe',
});

describe('a personal box (FR-018)', () => {
  it('reads what touches the objects, the « Kete » folder, its Sent folder — never the rest', async () => {
    expect(
      (await post(t.admin, '/threads/mailboxes', box('usr_kossi', 'kossi@kya.tg'))).status,
    ).toBe(201);
    // The client the center knows: read, cleaned of its quoted history and signature.
    kossiBox.deliver(
      mail({
        id: 'g1@hotel-golfe.tg',
        from: 'Direction <direction@hotel-golfe.tg>',
        to: 'kossi@kya.tg',
        subject: 'Salle 3',
        text: 'Il faut deux prises de plus dans la salle 3.\n\n--\nLa direction\n\n> Le 20 octobre, vous avez écrit :\n> Bien noté.',
      }),
    );
    // A friend: never read.
    kossiBox.deliver(
      mail({
        id: 'p1@gmail.com',
        from: 'Ami <ami@gmail.com>',
        to: 'kossi@kya.tg',
        subject: 'Foot dimanche',
        text: 'On joue dimanche ?',
      }),
    );
    expect(await readMailboxes()).toBe(1);
    // He drops a mail in « Kete »: it enters, whoever wrote it.
    kossiBox.deliver(
      mail({
        id: 'k1@fournisseur.tg',
        from: 'Ventes <ventes@fournisseur.tg>',
        to: 'kossi@kya.tg',
        subject: 'Devis prises',
        text: 'Voici notre devis pour les prises.',
      }),
      'Kete',
    );
    // His Sent folder, by the same rule: to the client yes, to a friend no.
    kossiBox.deliver(
      mail({
        id: 's1@kya.tg',
        from: 'Kossi <kossi@kya.tg>',
        to: 'direction@hotel-golfe.tg',
        subject: 'Re: Salle 3',
        text: 'Bien reçu, je mets à jour le devis.',
        inReplyTo: 'g1@hotel-golfe.tg',
      }),
      'Sent',
    );
    kossiBox.deliver(
      mail({
        id: 's2@kya.tg',
        from: 'Kossi <kossi@kya.tg>',
        to: 'ami@gmail.com',
        subject: 'Re: Foot dimanche',
        text: 'Oui !',
      }),
      'Sent',
    );
    expect(await readMailboxes()).toBe(2);

    const kossi = await list(t.kossi);
    const project = kossi.threads.find((x) => x.thread.title === 'Climatisation Hôtel du Golfe');
    const view = (await get(t.kossi, `/threads/${project?.thread.id}`)).body as {
      messages: { first: string; text: string; via: string; author: { id: string } }[];
      originals: Record<string, string>;
    };
    const fromClient = view.messages.find((m) => m.text.includes('deux prises'));
    expect(fromClient?.text).not.toContain('Bien noté');
    expect(view.originals[fromClient?.first ?? '']).toContain('Bien noté');
    const sent = view.messages.find((m) => m.text.includes('je mets à jour le devis'));
    expect(sent?.author.id).toBe('usr_kossi');
    expect(JSON.stringify(view.messages)).not.toContain('dimanche');
  });

  it('reads a shared box whole, and counts what each step placed this week', async () => {
    expect(
      (await post(t.admin, '/threads/mailboxes', box('usr_abla', 'contact@kya.tg'))).status,
    ).toBe(201);
    expect(
      (
        await post(t.kossi, '/threads/mailboxes/usr_abla/rules', {
          kind: 'shared',
          readSent: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(t.admin, '/threads/mailboxes/usr_abla/rules', {
          kind: 'shared',
          label: 'l’accueil',
          readSent: false,
        })
      ).status,
    ).toBe(200);
    desk.deliver(
      mail({
        id: 'n1@inconnu.tg',
        from: 'Quelqu’un <quelquun@inconnu.tg>',
        to: 'contact@kya.tg',
        subject: 'Renseignement',
        text: 'Bonjour, vous installez des panneaux ?',
      }),
    );
    expect(await readMailboxes()).toBe(1);
    expect((await get(t.kossi, '/threads/mailboxes/overview')).status).toBe(403);
    const overview = (await get(t.admin, '/threads/mailboxes/overview')).body as {
      mailboxes: { address: string; kind: string; label: string | null; week: number }[];
      steps: Record<string, number>;
      domain: string | null;
    };
    expect(overview.mailboxes).toEqual([
      expect.objectContaining({
        address: 'contact@kya.tg',
        kind: 'shared',
        label: 'l’accueil',
        week: 1,
      }),
      expect.objectContaining({ address: 'kossi@kya.tg', kind: 'personal', week: 3 }),
    ]);
    expect(overview.steps).toMatchObject({ reply: 1, contact: 1, classify: 2 });
    expect(overview.domain).toBeNull();
  });
});
