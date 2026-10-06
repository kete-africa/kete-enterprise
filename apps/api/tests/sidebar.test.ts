import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 049: the sidebar each person arranges — hers alone, on every device.

let db: TestSchema;
const api = createApi();
const t = { awa: '', kofi: '', other: '' };

type Answer = Record<string, unknown>;
interface Layout {
  hidden: string[];
  sections: { name: string | null; items: { kind: string; ref: string; label: string }[] }[];
}
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const layoutOf = (answer: { body: Answer }) => answer.body.layout as Layout;
const labels = (layout: Layout) => layout.sections.flatMap((s) => s.items.map((i) => i.label));

beforeAll(async () => {
  db = await startApi();
  t.awa = await tokenFor('usr_awa', { name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.other = await tokenFor('usr_awa', { name: 'Awa', org: 'org_other' });
});

afterAll(async () => {
  await db?.drop();
});

describe('the sidebar she arranges', () => {
  it('starts as Kete proposes it, and comes with /me', async () => {
    const answer = await call(t.awa, 'GET', '/sidebar');
    expect(answer.status).toBe(200);
    expect(layoutOf(answer)).toEqual({ hidden: [], sections: [{ name: null, items: [] }] });
    const me = await call(t.awa, 'GET', '/me');
    expect(me.body.sidebar).toEqual(layoutOf(answer));
  });

  it('pins a shortcut once, and unpins it', async () => {
    const pin = { kind: 'dashboard', ref: 'dsh_0001', label: 'Comité SAV du lundi' };
    expect((await call(t.awa, 'POST', '/sidebar/pin', pin)).status).toBe(200);
    const twice = await call(t.awa, 'POST', '/sidebar/pin', pin);
    expect(labels(layoutOf(twice))).toEqual(['Comité SAV du lundi']);
    const gone = await call(t.awa, 'POST', '/sidebar/unpin', {
      kind: 'dashboard',
      ref: 'dsh_0001',
    });
    expect(labels(layoutOf(gone))).toEqual([]);
  });

  it('keeps her sections, their order and the places she hides — but never Aujourd’hui', async () => {
    const layout = {
      hidden: ['dashboards', 'home', 'todo'],
      sections: [
        { name: null, items: [{ kind: 'place', ref: 'forms', label: 'Formulaires' }] },
        {
          name: 'Audit ISO',
          items: [
            { kind: 'dossier', ref: 'dos_0001', label: 'Audit ISO 9001 · 2026' },
            { kind: 'link', ref: '/tableaux-de-bord?vue=1', label: 'Mes tableaux' },
          ],
        },
      ],
    };
    const kept = await call(t.awa, 'POST', '/sidebar/arrange', { layout });
    expect(kept.status).toBe(200);
    const read = layoutOf(await call(t.awa, 'GET', '/sidebar'));
    expect(read.hidden).toEqual(['dashboards']);
    expect(read.sections.map((s) => s.name)).toEqual([null, 'Audit ISO']);
    expect(labels(read)).toEqual(['Formulaires', 'Audit ISO 9001 · 2026', 'Mes tableaux']);
  });

  it('is hers alone: neither a colleague nor another organization sees it', async () => {
    expect(labels(layoutOf(await call(t.kofi, 'GET', '/sidebar')))).toEqual([]);
    expect(labels(layoutOf(await call(t.other, 'GET', '/sidebar')))).toEqual([]);
  });

  it('refuses a link to another site or a script', async () => {
    for (const ref of ['https://ailleurs.test', '//ailleurs.test', 'javascript:alert(1)']) {
      const answer = await call(t.awa, 'POST', '/sidebar/pin', { kind: 'link', ref, label: 'x' });
      expect(answer.status).toBe(422);
    }
  });

  it('goes back to what Kete proposes', async () => {
    const reset = await call(t.awa, 'POST', '/sidebar/reset');
    expect(labels(layoutOf(reset))).toEqual([]);
    expect(layoutOf(await call(t.awa, 'GET', '/sidebar')).hidden).toEqual([]);
  });
});
