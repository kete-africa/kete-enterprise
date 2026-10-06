import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 054: the governance of AI — what each team spent this month, the share of answers found
// useful, what failed, and the journal of what the AI did, for administrators only.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '' };

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const idOf = async (token: string, path: string, body: object, field: string) =>
  String((await call(token, 'POST', path, body)).body[field] ?? '');

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa' });
  const type = await idOf(
    t.admin,
    '/structure/unit-types',
    { key: 'unit', name: 'Unité' },
    'unitTypeId',
  );
  const unit = await idOf(
    t.admin,
    '/structure/units',
    { unitTypeId: type, name: 'SAV', startsOn: '2026-01-01' },
    'unitId',
  );
  const position = await idOf(
    t.admin,
    '/structure/positions',
    { unitId: unit, title: 'Technicienne', startsOn: '2026-01-01' },
    'positionId',
  );
  const person = await idOf(
    t.admin,
    '/structure/people',
    { name: 'Awa', accountUserId: 'usr_awa' },
    'personId',
  );
  await call(t.admin, 'POST', '/structure/assignments', {
    personId: person,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  // This month's use of models: Awa's, through her assistant; one without a team.
  await db.owner.query(
    `insert into kete_ai_usage (organization_id, actor_kind, actor_id, on_behalf_of_id, purpose,
       model, input_tokens, output_tokens, model_calls)
     values ('org_kya', 'agent', 'agt_assistant', 'usr_awa', 'chat', 'm', 100, 50, 1),
            ('org_kya', 'agent', 'agt_assistant', 'usr_awa', 'chat', 'm', 30, 20, 1),
            ('org_kya', 'person', 'usr_lone', null, 'chat', 'm', 10, 0, 1),
            ('org_other', 'agent', 'agt_assistant', 'usr_x', 'chat', 'm', 999, 999, 1)`,
  );
  await db.owner.query(
    `insert into assistant_feedback (feedback_id, organization_id, user_id, conversation_id,
       message_id, helpful)
     values ('fdb_1', 'org_kya', 'usr_awa', 'cnv_00000000-1', 'm1', true),
            ('fdb_2', 'org_kya', 'usr_awa', 'cnv_00000000-1', 'm2', false),
            ('fdb_3', 'org_kya', 'usr_awa', 'cnv_00000000-1', 'm3', true)`,
  );
  await db.owner.query(
    `insert into kete_commands (command_id, organization_id, name, idempotency_key, input_hash,
       summary, actor_kind, actor_id, on_behalf_of_kind, on_behalf_of_id, channel, reversible)
     values ('cmd_1', 'org_kya', 'raise-signal', 'k1', 'h', 'Signal decisions.overdue', 'agent',
             'agt_sav', 'person', 'usr_awa', 'worker', true)`,
  );
});

afterAll(async () => {
  await db?.drop();
});

describe('the governance of AI', () => {
  it('shows each team’s use this month, the answers found useful and what failed', async () => {
    const answer = await call(t.admin, 'GET', '/governance');
    expect(answer.status).toBe(200);
    expect(answer.body.teams).toEqual([
      { unitId: expect.any(String), unit: 'SAV', calls: 2, tokens: 200, people: 1 },
      { unitId: null, unit: null, calls: 1, tokens: 10, people: 1 },
    ]);
    expect(answer.body.feedback).toEqual({ helpful: 2, judged: 3 });
    expect(answer.body.failures).toEqual({ tasks: 0, routines: 0 });
  });

  it('keeps the journal of what the AI did, for whom, through which channel', async () => {
    const journal = await call(t.admin, 'GET', '/governance/journal');
    expect(journal.body.lines).toEqual([
      expect.objectContaining({
        actor: 'agt_sav',
        onBehalfOf: 'usr_awa',
        channel: 'worker',
        command: 'raise-signal',
        reversible: true,
      }),
    ]);
  });

  it('is for administrators only', async () => {
    expect((await call(t.awa, 'GET', '/governance')).status).toBe(403);
    expect((await call(t.awa, 'GET', '/governance/journal')).status).toBe(403);
  });
});
