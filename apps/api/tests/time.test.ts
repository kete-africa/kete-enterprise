import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 079 (doctrine D-050): the apps say their dated facts to the center; Planifier shows each
// person her days, her team's, or the organization's when her rights open it — a busy fact and
// another person's absence without their words — and what clashes. The week of the canvas: Kossi
// away Thursday and Friday, the reception of the material on Friday is his.

let db: TestSchema;
const api = createApi();
const t = { admin: '', afi: '', kossi: '', yao: '', essi: '', other: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `time-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const say = (token: string, fact: object, source = 'kete-team') =>
  post(token, '/time/facts', { source, fact });

type Seen = { key: string; label: string; kind: string; masked?: boolean; person_ids?: string[] };
type Days = {
  facts: Seen[];
  conflicts: { kind: string; person: string }[];
  people: { name: string }[];
};
const days = async (token: string, scope = 'me') =>
  (await get(token, `/time/days?from=2026-10-12&days=7&scope=${scope}`)).body as unknown as Days;

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.afi = await tokenFor('usr_afi', { name: 'Afi Mensah' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Adjo' });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Amegah' });
  t.essi = await tokenFor('usr_essi', { name: 'Essi Dossou' });
  t.other = await tokenFor('usr_ailleurs', { org: 'org_ailleurs', role: 'admin' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Projets',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  const place = async (
    name: string,
    accountUserId: string,
    permissions: string[],
    reportsTo?: string,
  ) => {
    const positionId = (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title: name,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    if (permissions.length > 0) {
      const roleId = (
        await post(t.admin, '/rights/roles', { name: `Rôle de ${name}`, permissions })
      ).body.roleId;
      await post(t.admin, '/rights/grants', { roleId, positionId, startsOn: '2026-01-01' });
    }
    return positionId;
  };
  // Afi leads the projects; Kossi and Yao report to her; Essi, elsewhere, reads the organization's
  // time and says the time of others for Kete Team.
  const head = await place('Afi Mensah', 'usr_afi', []);
  await place('Kossi Adjo', 'usr_kossi', [], head);
  await place('Yao Amegah', 'usr_yao', [], head);
  await place('Essi Dossou', 'usr_essi', ['time:read', 'time:record']);
});

afterAll(async () => {
  await db?.drop();
});

describe('the time the apps say', () => {
  it('is said by the person it concerns, or by who records the time of others', async () => {
    const leave = {
      key: 'leave-kossi',
      kind: 'absence',
      label: 'Congé — mariage de sa sœur',
      day: '2026-10-15',
      until: '2026-10-16',
      person_ids: ['usr_kossi'],
    };
    expect((await say(t.yao, leave)).status).toBe(403);
    expect((await say(t.kossi, leave)).status).toBe(201);
    expect(
      (
        await say(t.essi, {
          key: 'reception',
          kind: 'task',
          label: 'Réception du matériel',
          starts_at: '2026-10-16T10:00:00Z',
          ends_at: '2026-10-16T11:00:00Z',
          person_ids: ['usr_kossi'],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await say(
          t.afi,
          {
            key: 'bank',
            kind: 'meeting',
            label: 'Ecobank — ligne de crédit',
            starts_at: '2026-10-14T11:00:00Z',
            ends_at: '2026-10-14T12:00:00Z',
            person_ids: ['usr_afi'],
            visibility: 'busy',
          },
          'agenda',
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await say(
          t.essi,
          {
            key: 'due',
            kind: 'deadline',
            label: 'Échéance F-2026-0003',
            day: '2026-10-15',
          },
          'kete-finance',
        )
      ).status,
    ).toBe(201);
    // What the contract refuses is refused here: a day and a moment, or neither.
    expect(
      (await say(t.kossi, { ...leave, key: 'x', starts_at: '2026-10-15T08:00:00Z' })).status,
    ).toBe(422);
    expect((await say(t.kossi, { key: 'x', kind: 'task', label: 'Rien' })).status).toBe(422);
  });

  it('shows her days, her team’s and the organization’s, never the reason of an absence', async () => {
    const kossi = await days(t.kossi);
    expect(kossi.facts.map((f) => f.key).sort()).toEqual([
      'kete-finance:due',
      'kete-team:leave-kossi',
      'kete-team:reception',
    ]);
    expect(kossi.facts.find((f) => f.kind === 'absence')?.label).toBe('Congé — mariage de sa sœur');
    expect(kossi.conflicts).toEqual([
      expect.objectContaining({ kind: 'absent', person: 'usr_kossi' }),
    ]);
    // Afi, his manager: in « Mon équipe », his leave without its words, the clash said.
    const team = await days(t.afi, 'team');
    const leave = team.facts.find((f) => f.kind === 'absence');
    expect(leave).toMatchObject({ label: '', masked: true });
    expect(team.conflicts).toHaveLength(1);
    expect(team.people.map((p) => p.name).sort()).toEqual([
      'Afi Mensah',
      'Kossi Adjo',
      'Yao Amegah',
    ]);
    // In her own view, not his.
    expect((await days(t.afi)).facts.map((f) => f.key).sort()).toEqual([
      'agenda:bank',
      'kete-finance:due',
    ]);
    // Yao sees no one's but his own and what concerns everyone.
    expect((await days(t.yao)).facts.map((f) => f.key)).toEqual(['kete-finance:due']);
    // The organization: for who reads it — Afi's bank meeting only « busy ».
    expect((await get(t.yao, '/time/days?from=2026-10-12&scope=organization')).status).toBe(403);
    const all = await days(t.essi, 'organization');
    expect(all.facts.find((f) => f.key === 'agenda:bank')).toMatchObject({
      label: '',
      masked: true,
    });
    // Another organization sees nothing of it.
    expect((await days(t.other)).facts).toEqual([]);
  });

  it('is replaced under its key, and taken back', async () => {
    // Given to Yao, the reception clashes with nothing.
    await say(t.essi, {
      key: 'reception',
      kind: 'task',
      label: 'Réception du matériel',
      starts_at: '2026-10-16T10:00:00Z',
      ends_at: '2026-10-16T11:00:00Z',
      person_ids: ['usr_yao'],
    });
    expect((await days(t.afi, 'team')).conflicts).toEqual([]);
    expect(
      (await post(t.yao, '/time/facts/drop', { source: 'kete-team', key: 'leave-kossi' })).status,
    ).toBe(403);
    expect(
      (
        await say(t.kossi, {
          key: 'leave-kossi',
          kind: 'absence',
          label: 'Congé',
          day: '2026-10-15',
          person_ids: ['usr_kossi'],
          cancelled: true,
        })
      ).status,
    ).toBe(200);
    expect((await days(t.kossi)).facts.map((f) => f.kind)).not.toContain('absence');
  });
});
