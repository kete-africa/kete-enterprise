import { memoryPushSender } from '@kete/notify';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { usePushSender } from '../src/features/notifications/index.js';
import { matches } from '../src/features/search/index.js';
import { useCardReader } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 030: what a person is told — in Kete Enterprise and on her devices by Web Push — and one
// search across what she may see.

let db: TestSchema;
const api = createApi();
const t = { kofi: '', esi: '' };
let key = 0;
const push = memoryPushSender();

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `notif-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

beforeAll(async () => {
  db = await startApi();
  usePushSender(push);
  useCardReader(async () => null);
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
});

afterAll(async () => {
  usePushSender(undefined);
  await db?.drop();
});

describe('notifications', () => {
  it('subscribes her device, and tells it when an app puts a task in her To do', async () => {
    const before = await call(t.kofi, 'GET', '/notifications');
    expect(before.body).toMatchObject({
      notifications: [],
      unread: 0,
      pushKey: 'BMemoryPublicKey',
    });
    const device = {
      endpoint: 'https://push.example/kofi-phone',
      keys: { p256dh: 'p256dh-key-of-kofi', auth: 'auth-kofi' },
    };
    expect((await call(t.kofi, 'POST', '/notifications/push', device)).status).toBe(201);
    await call(t.kofi, 'POST', '/workspace/tasks', {
      source: 'Support',
      key: 'T-1047',
      title: 'Ticket T-1047 vous est assigné',
      href: 'https://helpdesk.example/tickets/T-1047',
    });
    const after = await call(t.kofi, 'GET', '/notifications');
    expect(after.body).toMatchObject({
      unread: 1,
      notifications: [
        { kind: 'task.added', title: 'Support : Ticket T-1047 vous est assigné', read: false },
      ],
    });
    expect(push.sent).toEqual([
      {
        endpoint: device.endpoint,
        message: expect.objectContaining({
          title: 'Support : Ticket T-1047 vous est assigné',
          href: 'https://helpdesk.example/tickets/T-1047',
        }),
      },
    ]);
    expect((await call(t.esi, 'GET', '/notifications')).body).toMatchObject({ unread: 0 });
  });

  it('marks them read', async () => {
    expect((await call(t.kofi, 'POST', '/notifications/read', {})).status).toBe(422);
    expect((await call(t.kofi, 'POST', '/notifications/read', { all: true })).body).toEqual({
      read: 1,
    });
    expect((await call(t.kofi, 'GET', '/notifications')).body).toMatchObject({ unread: 0 });
  });
});

describe('searching everywhere', () => {
  it('matches every word, accents and case aside', () => {
    expect(matches('agoe batteries', 'Batteries du site d’Agoè')).toBe(true);
    expect(matches('agoe onduleur', 'Batteries du site d’Agoè')).toBe(false);
  });

  it('finds her own things, never another person’s', async () => {
    await db.owner.query(
      `insert into ${db.schema}.assistant_conversations (conversation_id, organization_id, user_id, title)
       values ('cnv_00000000-0000-0000-0000-000000000001', 'org_kya', 'usr_kofi', 'Batteries d’Agoè')`,
    );
    await call(t.kofi, 'POST', '/registry/resources', {
      kind: 'app',
      name: 'Support',
      address: 'https://helpdesk.example.test',
    });
    const kofi = (await call(t.kofi, 'GET', `/search?q=${encodeURIComponent('agoe batteries')}`))
      .body.results as { kind: string; title: string }[];
    expect(kofi).toContainEqual(
      expect.objectContaining({ kind: 'conversation', title: 'Batteries d’Agoè' }),
    );
    const esi = (await call(t.esi, 'GET', `/search?q=${encodeURIComponent('agoe batteries')}`)).body
      .results as unknown[];
    expect(esi).toEqual([]);
    const apps = (await call(t.kofi, 'GET', '/search?q=support')).body.results as {
      kind: string;
    }[];
    expect(apps).toContainEqual(expect.objectContaining({ kind: 'app', title: 'Support' }));
    expect((await call(t.kofi, 'GET', '/search?q=a')).status).toBe(422);
  });
});
