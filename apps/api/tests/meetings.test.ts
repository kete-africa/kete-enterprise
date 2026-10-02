import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 013: a meeting starts from the gaps, holds its quorum, turns decisions into actions in one
// register, publishes its record on time; decision notes take the next number of the year.

let db: TestSchema;
const api = createApi();
const t = { admin: '', secretary: '', dg: '', kofi: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `meetings-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!text.startsWith('{'))
    console.log('NOT JSON', method, path, response.status, text.slice(0, 80));
  return {
    status: response.status,
    body: (text.startsWith('{') ? JSON.parse(text) : {}) as Answer,
  };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const id = (answer: { body: Answer }, field: string) => String(answer.body[field] ?? '');

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  for (const who of ['secretary', 'dg', 'kofi'] as const) t[who] = await tokenFor(`usr_${who}`);
  await post(t.admin, '/organization/modules', { module: 'meetings', enabled: true });
  const type = id(
    await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' }),
    'unitTypeId',
  );
  const top = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'KYA-Energy Group',
      code: 'KEG',
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  const position = async (title: string, reportsTo?: string) =>
    id(
      await post(t.admin, '/structure/positions', {
        unitId: top,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      }),
      'positionId',
    );
  ids.dgPos = await position('Directeur Général');
  ids.secPos = await position('Assistante de direction', ids.dgPos);
  ids.kofiPos = await position('Directeur Technique', ids.dgPos);
  const person = async (name: string, positionId: string, account: string) => {
    const personId = id(
      await post(t.admin, '/structure/people', { name, accountUserId: account }),
      'personId',
    );
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    return personId;
  };
  ids.dg = await person('Yaw', ids.dgPos, 'usr_dg');
  ids.sec = await person('Akossiwa', ids.secPos, 'usr_secretary');
  ids.kofi = await person('Kofi', ids.kofiPos, 'usr_kofi');
  const role = id(
    await post(t.admin, '/rights/roles', {
      name: 'Secrétariat',
      permissions: ['meetings:manage', 'meetings:publish'],
    }),
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: ids.secPos,
    startsOn: '2026-01-01',
  });
});

afterAll(async () => {
  await db?.drop();
});

describe('a Codir', () => {
  it('starts from the gaps: an action past due is on the agenda', async () => {
    expect((await post(t.kofi, '/meetings/types', { name: 'X', kind: 'decision' })).status).toBe(
      403,
    );
    await post(t.secretary, '/actions', {
      title: 'Relancer le client SAV',
      responsiblePersonId: ids.kofi,
      dueOn: '2026-09-01',
    });
    ids.codir = id(
      await post(t.secretary, '/meetings/types', {
        name: 'Comité de Direction',
        kind: 'decision',
        cadence: 'Mensuel — 1er mardi, 2 h',
        durationMinutes: 120,
        memberPositionIds: [ids.dgPos, ids.kofiPos, ids.secPos],
        quorum: 2,
        recordWithinHours: 48,
      }),
      'typeId',
    );
    const planned = await post(t.secretary, '/meetings/meetings', {
      typeId: ids.codir,
      startsAt: '2026-10-06T08:00:00Z',
    });
    expect(planned.body).toMatchObject({ agenda: 1 });
    ids.meeting = id(planned, 'meetingId');
    await post(t.secretary, `/meetings/meetings/${ids.meeting}/agenda`, {
      title: 'Ouverture de l’agence Niger',
    });
    const meeting = (await get(t.secretary, `/meetings/meetings/${ids.meeting}`)).body.meeting as {
      agenda: { kind: string }[];
    };
    expect(meeting.agenda.map((a) => a.kind)).toEqual(['overdue_action', 'manual']);
  });

  it('checks its quorum, turns a decision into an action, and publishes its record on time', async () => {
    const held = await post(t.secretary, `/meetings/meetings/${ids.meeting}/hold`, {
      presentPersonIds: [ids.dg, ids.kofi],
    });
    expect(held.body).toMatchObject({ quorumMet: true });
    const decided = await post(t.secretary, `/meetings/meetings/${ids.meeting}/decisions`, {
      text: 'Recruter un chef d’agence pour Niamey',
      responsiblePersonId: ids.kofi,
      dueOn: '2026-11-15',
    });
    expect(decided.body.actionId).toMatch(/^act_/);
    const mine = (await get(t.kofi, '/actions')).body.actions as {
      title: string;
      overdue: boolean;
    }[];
    expect(mine.map((a) => [a.title, a.overdue])).toEqual([
      ['Relancer le client SAV', true],
      ['Recruter un chef d’agence pour Niamey', false],
    ]);
    // Kofi does not see the meeting before its record is published.
    expect((await get(t.kofi, `/meetings/meetings/${ids.meeting}`)).status).toBe(404);
    const published = await post(t.secretary, `/meetings/meetings/${ids.meeting}/publish`, {
      notes: 'Séance tenue.',
    });
    expect(published.body).toMatchObject({ onTime: true });
    expect((await get(t.kofi, `/meetings/meetings/${ids.meeting}`)).status).toBe(200);
  });

  it('lets an action’s owner close it, and nobody else', async () => {
    const action = ((await get(t.kofi, '/actions')).body.actions as { actionId: string }[])[0]
      ?.actionId;
    expect((await post(t.dg, `/actions/${action}/done`, { note: 'Fait' })).status).toBe(403);
    expect(
      (await post(t.kofi, `/actions/${action}/done`, { note: 'Client relancé le 2/10' })).status,
    ).toBe(201);
  });
});

describe('decision notes', () => {
  it('take the next number of the year, and count who read them', async () => {
    const year = new Date().getUTCFullYear();
    const draft = async (subject: string) =>
      id(
        await post(t.secretary, '/meetings/notes', {
          subject,
          body: 'Il est décidé…',
          signedByPersonId: ids.dg,
        }),
        'noteId',
      );
    const first = await draft('Réorganisation');
    const second = await draft('Nominations');
    expect((await post(t.secretary, `/meetings/notes/${first}/publish`)).body).toMatchObject({
      number: `${year}-001/DG/KEG`,
    });
    expect((await post(t.secretary, `/meetings/notes/${second}/publish`)).body).toMatchObject({
      number: `${year}-002/DG/KEG`,
    });
    await post(t.kofi, `/meetings/notes/${first}/read`);
    await post(t.kofi, `/meetings/notes/${first}/read`);
    const notes = (await get(t.kofi, '/meetings')).body.notes as {
      number: string;
      reads: number;
      readByMe: boolean;
    }[];
    expect(notes.find((n) => n.number === `${year}-001/DG/KEG`)).toMatchObject({
      reads: 1,
      readByMe: true,
    });
  });
});
