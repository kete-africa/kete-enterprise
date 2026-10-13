import { createHmac, randomBytes } from 'node:crypto';
import { memoryChatChannel } from '@kete/notify';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { deliverPhones, usePhoneChannels } from '../src/features/phone/index.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 077 — the center on a phone. The proof of step F5: « A decision is taken by a reply on a
// phone » — what waits for her decision arrives on her WhatsApp with two buttons, and her tap
// decides it, journaled as hers.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '', kossi: '' };
let key = 0;
const ids = {} as Record<'first' | 'second', string>;
const channel = memoryChatChannel('whatsapp');
const APP_SECRET = 'secret-of-the-number';

const card: IdentityCard = {
  product: 'prd_kete_finance',
  name: 'Kete Finance',
  version: '1.0.0',
  client: 'cli_finance',
  subjects: [{ name: 'purchase', label: { fr: 'Achat', en: 'Purchase' } }],
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `phone-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) =>
  call(token, 'POST', `/v1${path}`, body);
const get = (token: string, path: string) => call(token, 'GET', `/v1${path}`);

/** WhatsApp tells the center Kossi tapped a button, signed with the number's own secret. */
async function tap(buttonId: string, messageId: string) {
  const raw = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '7007' },
              contacts: [{ wa_id: '22890112233' }],
              messages: [
                {
                  from: '22890112233',
                  id: messageId,
                  type: 'interactive',
                  interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  return api.request('/public/chat/whatsapp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
    },
    body: raw,
  });
}
const ask = (reference: string) =>
  post(t.kofi, '/apps/prd_kete_finance/decisions', {
    subject: 'purchase',
    reference,
    title: `Câbles solaires ${reference}`,
    measure: 120_000,
  });
type Mine = { requestId: string; status: string; steps: { decidedBy: string | null }[] }[];
const mine = async () => (await get(t.kofi, '/decisions/inbox')).body.mine as Mine;

beforeAll(async () => {
  db = await startApi();
  usePhoneChannels({ secretsKey: randomBytes(32).toString('base64'), connect: () => channel });
  useCardReader(async (address) => (address.includes('finance') ? card : null));
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi' });
  await post(t.admin, '/registry/resources', {
    kind: 'app',
    name: 'Kete Finance',
    address: 'https://finance.example.test',
  });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Chantiers',
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
      .personId as string;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  };
  const chef = await position('Chef de chantier');
  await assign('Kossi', 'usr_kossi', chef);
  await assign('Kofi', 'usr_kofi', await position('Technicien', chef));
  expect(
    (
      await post(t.admin, '/decisions/circuits', {
        subject: 'prd_kete_finance.purchase',
        name: 'Achats',
        steps: [{ rule: 'manager' }],
      })
    ).status,
  ).toBe(201);
});

afterAll(async () => {
  usePhoneChannels({});
  await db?.drop();
});

describe('a decision is taken by a reply on a phone', () => {
  it('lets only an administrator connect the organization’s number', async () => {
    const sender = {
      channel: 'whatsapp',
      phoneNumberId: '7007',
      accessToken: 'token-of-the-number',
      appSecret: APP_SECRET,
      label: 'Standard',
    };
    expect((await post(t.kossi, '/phone/senders', sender)).status).toBe(403);
    expect(await post(t.admin, '/phone/senders', sender)).toMatchObject({
      status: 200,
      body: { connected: 'whatsapp' },
    });
  });

  it('sends nothing to a phone she did not tie', async () => {
    ids.first = String((await ask('pur_1')).body.requestId);
    await deliverPhones();
    expect(channel.sent).toEqual([]);
  });

  it('sends what waits for her, with two buttons, once she tied her phone', async () => {
    expect(
      await post(t.kossi, '/phone', { channel: 'whatsapp', phone: '+228 90 11 22 33' }),
    ).toMatchObject({
      status: 200,
      body: { tied: true, channel: 'whatsapp' },
    });
    expect((await get(t.kossi, '/phone')).body).toMatchObject({
      tied: true,
      senders: ['whatsapp'],
    });
    const asked = await ask('pur_2');
    expect(asked.body).toMatchObject({ status: 'pending' });
    await deliverPhones();
    const requestId = String(asked.body.requestId);
    ids.second = requestId;
    expect(channel.sent).toEqual([
      {
        kind: 'text',
        to: '22890112233',
        text: 'Votre décision est attendue : Câbles solaires pur_2',
        actions: [
          { id: `approve:${requestId}`, label: 'Approuver' },
          { id: `refuse:${requestId}`, label: 'Refuser' },
        ],
      },
    ]);
  });

  it('decides it by her tap, as hers, and answers her', async () => {
    const requestId = ids.second;
    expect((await tap(`approve:${requestId}`, 'wamid.A1')).status).toBe(200);
    const decided = (await mine()).find((one) => one.requestId === requestId);
    expect(decided).toMatchObject({ status: 'approved', steps: [{ decidedBy: 'usr_kossi' }] });
    // The journal names her, and the channel she decided through.
    const { rows } = await db.owner.query<{
      actor_kind: string;
      actor_id: string;
      channel: string;
    }>(
      `select actor_kind, actor_id, channel from ${db.schema}.kete_commands where name = 'decide-request'`,
    );
    expect(rows).toEqual([{ actor_kind: 'person', actor_id: 'usr_kossi', channel: 'whatsapp' }]);
    await deliverPhones();
    expect(channel.sent.at(-1)).toMatchObject({
      to: '22890112233',
      text: 'Approuvé : Câbles solaires pur_2. C’est noté dans Kete Enterprise.',
    });
  });

  it('decides once when the same tap arrives twice, and refuses what is no longer hers', async () => {
    // The first request, asked before her phone was tied, still waits for her.
    const pending = { requestId: ids.first };
    expect((await tap(`refuse:${pending?.requestId}`, 'wamid.R1')).status).toBe(200);
    expect((await tap(`refuse:${pending?.requestId}`, 'wamid.R1')).status).toBe(200);
    expect((await mine()).find((one) => one.requestId === pending?.requestId)).toMatchObject({
      status: 'refused',
    });
    // Tapped again, later, under another message: it is no longer hers to decide.
    expect((await tap(`approve:${pending?.requestId}`, 'wamid.R2')).status).toBe(200);
    await deliverPhones();
    expect(channel.sent.at(-1)).toMatchObject({
      text: 'Cette décision n’est plus la vôtre : elle a été prise, ou elle attend quelqu’un d’autre.',
    });
    expect((await mine()).find((one) => one.requestId === pending?.requestId)).toMatchObject({
      status: 'refused',
    });
  });

  it('refuses a tap whose signature is not the number’s, and stops at her word', async () => {
    const forged = await api.request('/public/chat/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      body: JSON.stringify({
        entry: [{ changes: [{ value: { metadata: { phone_number_id: '7007' }, messages: [] } }] }],
      }),
    });
    expect(forged.status).toBe(401);
    expect((await post(t.kossi, '/phone/untie')).body).toEqual({ tied: false });
    const sent = channel.sent.length;
    await ask('pur_3');
    await deliverPhones();
    expect(channel.sent.length).toBe(sent);
  });
});
