import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 018: a connected app puts what waits for a person in her one To do, with her own token;
// sending it again updates it; closing it takes it out; nobody else sees it.

let db: TestSchema;
const api = createApi();
const t = { ama: '', kofi: '', other: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `tasks-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const task = {
  source: 'kete-helpdesk',
  key: 'tkt_1',
  title: 'Rétablir : onduleur en défaut',
  href: 'https://helpdesk.example.test/tickets/tkt_1',
  dueAt: '2026-10-03T14:00:00Z',
};

beforeAll(async () => {
  db = await startApi();
  t.ama = await tokenFor('usr_ama', { role: 'admin' });
  t.kofi = await tokenFor('usr_kofi');
  t.other = await tokenFor('usr_ama', { org: 'org_other' });
});

afterAll(async () => {
  await db?.drop();
});

describe('the tasks of the team’s apps', () => {
  it('land in the person’s To do, once per app and key', async () => {
    expect((await call(t.ama, 'POST', '/workspace/tasks', task)).status).toBe(201);
    await call(t.ama, 'POST', '/workspace/tasks', { ...task, title: 'Rétablir avant 14 h' });
    const mine = (await call(t.ama, 'GET', '/workspace/tasks')).body.tasks as Answer[];
    expect(mine).toEqual([
      expect.objectContaining({ source: 'kete-helpdesk', title: 'Rétablir avant 14 h' }),
    ]);
  });

  it('stay hers: another person, another organization see nothing', async () => {
    expect((await call(t.kofi, 'GET', '/workspace/tasks')).body.tasks).toEqual([]);
    expect((await call(t.other, 'GET', '/workspace/tasks')).body.tasks).toEqual([]);
  });

  it('refuse an address that is not https', async () => {
    const refused = await call(t.ama, 'POST', '/workspace/tasks', {
      ...task,
      key: 'tkt_2',
      href: 'javascript:alert(1)',
    });
    expect(refused.status).toBe(422);
  });

  it('leave her To do once closed', async () => {
    await call(t.ama, 'POST', '/workspace/tasks/close', { source: task.source, key: task.key });
    expect((await call(t.ama, 'GET', '/workspace/tasks')).body.tasks).toEqual([]);
  });
});
