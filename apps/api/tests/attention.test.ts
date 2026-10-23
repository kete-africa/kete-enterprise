import { DEFAULT_ATTENTION, memoryPushSender, type AttentionPrefs } from '@kete/notify';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { sendDigests } from '../src/features/messages/index.js';
import {
  keepAttention,
  ring,
  ringAfterQuiet,
  tell,
  usePushSender,
  type Tell,
} from '../src/features/notifications/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 109 (kete-core spec 151; doctrine D-062, R14): one attention model decides who is told, of
// what, on which channel, once — her quiet hours read at her own hour, kept when she opens
// « Pour moi »; what asks her to act waits for them to end; what she only needs to know never rings;
// a thread does not ring in them; her summary leaves at her own evening hour.

const ORG = 'org_attention';
let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
let key = 0;
const push = memoryPushSender();

async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `attention-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const pad = (hour: number) => `${String((hour + 24) % 24).padStart(2, '0')}:00`;
const hour = new Date().getUTCHours();
/** Quiet now, in UTC: from this hour to two hours later. */
const quietNow = { from: pad(hour), to: pad(hour + 2) };
/** Quiet later: not now. */
const quietLater = { from: pad(hour + 3), to: pad(hour + 4) };
const keep = (prefs: Partial<AttentionPrefs>) =>
  transaction(ORG, (client) =>
    keepAttention(client, 'usr_awa', { ...DEFAULT_ATTENTION, timeZone: 'UTC', ...prefs }),
  );
const waiting: Tell = {
  kind: 'decision.waiting',
  title: 'Achat de 12 batteries : votre décision est attendue',
  href: '/a-faire',
};
const told = async () =>
  ((await call(t.awa, 'GET', '/notifications')).body.notifications as { title: string }[]).filter(
    (n) => n.title === waiting.title,
  ).length;

beforeAll(async () => {
  db = await startApi();
  usePushSender(push);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.awa = await tokenFor('usr_awa', { name: 'Awa', org: ORG });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi', org: ORG });
  await call(t.admin, 'POST', '/structure/people', {
    name: 'Awa',
    email: 'awa@example.test',
    accountUserId: 'usr_awa',
  });
  await call(t.admin, 'POST', '/structure/people', { name: 'Kofi', accountUserId: 'usr_kofi' });
  await call(t.awa, 'POST', '/notifications/push', {
    endpoint: 'https://push.example/awa',
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  });
});

afterAll(async () => {
  usePushSender(undefined);
  await db?.drop();
});

describe('one attention model', () => {
  it('tells once by its key, and rings what asks her to act outside her quiet hours', async () => {
    await keep({ quietHours: quietLater });
    for (let i = 0; i < 2; i += 1) {
      await transaction(ORG, (client) =>
        tell(client, ORG, 'usr_awa', waiting, { key: 'decision:drq_1:1' }),
      );
    }
    expect(await told()).toBe(1);
    expect(push.sent).toHaveLength(1);
  });

  it('holds it in her quiet hours, and rings it once they end', async () => {
    await keep({ quietHours: quietNow });
    push.sent.length = 0;
    await transaction(ORG, (client) =>
      tell(client, ORG, 'usr_awa', { ...waiting, title: 'Devis Mensah' }, { key: 'drq_2' }),
    );
    expect(push.sent).toHaveLength(0);
    expect(await ringAfterQuiet()).toBe(0);
    await db.owner.query(
      `update ${db.schema}.kete_attention set devices_after = now() - interval '1 minute'
        where key = 'drq_2'`,
    );
    expect(await ringAfterQuiet()).toBe(1);
    expect(push.sent.map((s) => s.message.title)).toEqual(['Devis Mensah']);
  });

  it('rings what is urgent even in her quiet hours', async () => {
    await keep({ quietHours: quietNow });
    push.sent.length = 0;
    await transaction(ORG, (client) =>
      tell(
        client,
        ORG,
        'usr_awa',
        { kind: 'holding.nudged', title: 'Panne à Tsévié : à reprendre', href: '/pour-moi' },
        { weight: 'urgent', key: 'nudge:urgent' },
      ),
    );
    expect(push.sent).toHaveLength(1);
  });

  it('never rings what she only needs to know', async () => {
    await keep({ quietHours: quietLater });
    push.sent.length = 0;
    await transaction(ORG, (client) =>
      tell(client, ORG, 'usr_awa', {
        kind: 'agent.task',
        title: 'Votre agent a terminé',
        href: '/mes-agents',
      }),
    );
    expect(push.sent).toHaveLength(0);
  });

  it('does not ring a thread in her quiet hours', async () => {
    const message = {
      kind: 'thread.message' as const,
      title: 'Kofi · Chantier',
      body: 'La pose est finie',
      href: '/fils',
    };
    await keep({ quietHours: quietNow });
    expect(await transaction(ORG, (client) => ring(client, 'usr_awa', message))).toBe(0);
    await keep({ quietHours: quietLater });
    expect(await transaction(ORG, (client) => ring(client, 'usr_awa', message))).toBe(1);
  });

  it('sends her summary at her own evening hour', async () => {
    const opened = await call(t.kofi, 'POST', '/threads', {
      kind: 'group',
      title: 'Chantier de Tsévié',
      members: [{ kind: 'person', id: 'usr_awa' }],
    });
    const threadId = (opened.body.thread as { id: string }).id;
    await call(t.kofi, 'POST', `/threads/${threadId}/messages`, { text: 'La pose est finie.' });
    await db.owner.query(
      `update ${db.schema}.people set threads_digest = 'daily' where account_user_id = 'usr_awa'`,
    );
    // 10:00 UTC: morning in Lomé, 19:00 in Tokyo.
    const ten = new Date('2026-10-23T10:00:00Z');
    await keep({ timeZone: 'Africa/Lome', digest: 'daily' });
    expect(await sendDigests(ten)).toBe(0);
    await keep({ timeZone: 'Asia/Tokyo', digest: 'daily' });
    expect(await sendDigests(ten)).toBe(1);
    expect(await sendDigests(ten)).toBe(0);
  });
});
