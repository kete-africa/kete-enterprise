import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runTask, useTaskModel } from '../src/features/agents/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 099, part C (FR-013 to FR-017): an agent is a colleague. Awa gives her agent work by
// talking in its thread; its answer comes back there with its steps; what it asks waits under it —
// once, always (her policy, simulated), or not; asked by its routine, it expires. It takes on her
// holdings as its job description says, and the holding stays hers.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
const ids = {} as Record<'awa' | 'agent' | 'thread' | 'group', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `colleagues-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const id = async (token: string, path: string, body: object, field: string) =>
  String((await post(token, path, body)).body[field] ?? '');

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
/** A model that proposes an action (a draft for her), then answers. */
const proposes = (title: string, text: string) => {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      return step % 2 === 1
        ? {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `c${step}`,
                toolName: 'actions_propose',
                input: JSON.stringify({
                  title,
                  responsiblePersonId: ids.awa,
                  dueOn: '2026-11-15',
                }),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
            usage,
            warnings: [],
          }
        : { content: [{ type: 'text' as const, text }], finishReason: stop, usage, warnings: [] };
    },
  });
};

type View = {
  thread: { id: string };
  messages: { id: string; first: string; text: string; author: { kind: string; id: string } }[];
  runs: Record<string, { title: string; steps: { state: string; label: string }[] }>;
  requests: Record<
    string,
    { draftId: string; capability: string; status: string; always: boolean; expired: boolean }[]
  >;
  proposals: Record<string, { proposalId: string; kind: string; body: Record<string, unknown> }[]>;
  agent: {
    name: string;
    takeOn: Record<string, string>;
    computerMinutes: number | null;
    routine: { time: string } | null;
    trialUntil: string | null;
  } | null;
  turn: { turnId: string } | null;
};
const view = async (token: string, threadId: string) =>
  (await get(token, `/threads/${threadId}`)).body as unknown as View;
const lastAnswer = (v: View) => [...v.messages].reverse().find((m) => m.author.kind === 'agent');
const taskOf = async (taskId: string) => {
  const { rows } = await db.owner.query(
    `select status, draft_ids from ${db.schema}.agent_tasks where task_id = $1`,
    [taskId],
  );
  return rows[0] as { status: string; draft_ids: string[] };
};

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { role: 'member', name: 'Kofi' });
  await post(t.admin, '/organization/modules', { module: 'meetings', enabled: true });
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  const type = await id(
    t.admin,
    '/structure/unit-types',
    { key: 'unit', name: 'Unité' },
    'unitTypeId',
  );
  const unit = await id(
    t.admin,
    '/structure/units',
    { unitTypeId: type, name: 'Agence de Lomé', startsOn: '2026-01-01' },
    'unitId',
  );
  const position = await id(
    t.admin,
    '/structure/positions',
    { unitId: unit, title: 'Commerciale', startsOn: '2026-01-01' },
    'positionId',
  );
  ids.awa = await id(
    t.admin,
    '/structure/people',
    { name: 'Awa', accountUserId: 'usr_awa' },
    'personId',
  );
  await post(t.admin, '/structure/assignments', {
    personId: ids.awa,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  const role = await id(
    t.admin,
    '/rights/roles',
    { name: 'Réunions', permissions: ['meetings:manage'] },
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: position,
    startsOn: '2026-01-01',
  });
  ids.agent = await id(
    t.awa,
    '/agents',
    {
      name: 'Agent Relances',
      kind: 'personal',
      mission: 'Relancer les clients en retard.',
      permissions: ['meetings:manage'],
      autonomyMax: 3,
      draftBudget: 5,
      watches: ['decisions'],
    },
    'agentId',
  );
});

afterAll(async () => {
  useTaskModel(undefined);
  await db?.drop();
});

describe('an agent is a colleague (FR-013, FR-014)', () => {
  it('takes work in its own thread, answers there with its steps, and says where it stands', async () => {
    expect((await post(t.kofi, `/threads/agents/${ids.agent}/thread`)).status).toBe(404);
    ids.thread = String((await post(t.awa, `/threads/agents/${ids.agent}/thread`)).body.threadId);
    const said = await post(t.awa, `/threads/${ids.thread}/messages`, {
      text: 'Prépare la relance du client Mensah.',
    });
    const taskId = String(said.body.turn);
    expect(taskId).toMatch(/^tsk_/);
    // Spoken to while it waits: the same task reads it before its next step.
    const again = await post(t.awa, `/threads/${ids.thread}/messages`, { text: 'Pour vendredi.' });
    expect(again.body.turn).toBe(taskId);
    expect((await view(t.awa, ids.thread)).turn?.turnId).toBe(taskId);
    let screen = (await get(t.awa, '/threads/agents')).body as {
      agents: { agentId: string; state: string }[];
      working: number;
    };
    expect(screen.agents.find((a) => a.agentId === ids.agent)?.state).toBe('working');
    expect(screen.working).toBe(1);

    useTaskModel(
      proposes('Relancer le client Mensah', 'J’ai préparé la relance ; elle attend votre accord.'),
    );
    expect(await runTask('org_kya', taskId)).toBe('done');
    const after = await view(t.awa, ids.thread);
    const answer = lastAnswer(after);
    expect(answer?.text).toContain('attend votre accord');
    expect(after.runs[answer?.id ?? '']?.steps).toEqual([
      expect.objectContaining({ state: 'ask', label: 'actions_propose' }),
    ]);
    expect(after.requests[answer?.first ?? '']).toEqual([
      expect.objectContaining({ capability: 'actions_propose', status: 'prepared', always: true }),
    ]);
    screen = (await get(t.awa, '/threads/agents')).body as typeof screen;
    expect(screen.agents.find((a) => a.agentId === ids.agent)?.state).toBe('needs');
  });
});

describe('its requests never block (FR-015)', () => {
  it('is allowed once, then « Toujours… » proposes her policy, which decides the next ones', async () => {
    const first = lastAnswer(await view(t.awa, ids.thread));
    const before = (await view(t.awa, ids.thread)).requests[first?.first ?? ''] ?? [];
    const once = await post(t.awa, `/threads/requests/${before[0]?.draftId}/once`);
    expect(once.body).toMatchObject({ status: 'validated' });
    expect((await post(t.kofi, `/threads/requests/${before[0]?.draftId}/once`)).status).toBe(404);

    // A second request: « Toujours… » allows it, and proposes the policy, simulated.
    const said = await post(t.awa, `/threads/${ids.thread}/messages`, {
      text: 'Et le client Dossou.',
    });
    useTaskModel(proposes('Relancer le client Dossou', 'Préparée.'));
    await runTask('org_kya', String(said.body.turn));
    const v = await view(t.awa, ids.thread);
    const answer = lastAnswer(v);
    const request = (v.requests[answer?.first ?? ''] ?? [])[0];
    const always = await post(t.awa, `/threads/requests/${request?.draftId}/always`);
    expect(always.body).toMatchObject({
      status: 'validated',
      proposalId: expect.stringMatching(/^prp_/),
    });
    const proposal = ((await view(t.awa, ids.thread)).proposals[answer?.first ?? ''] ?? [])[0];
    expect(proposal?.kind).toBe('policy');
    expect(proposal?.body).toMatchObject({
      template: 'agent.alone',
      policy: { id: `agent.${ids.agent}.actions_propose`, set: 'authority' },
      simulation: { changed: 0 },
    });
    // Hers to adopt: her own agent's policy, though she is no administrator.
    const adopted = await post(t.awa, `/threads/proposals/${proposal?.proposalId}/policy`, {
      how: 'adopt',
    });
    expect(adopted.body).toMatchObject({ status: 'active' });

    // In force: its next draft of that kind is decided by her policy at once.
    const third = await post(t.awa, `/threads/${ids.thread}/messages`, { text: 'Et Agbeko.' });
    useTaskModel(proposes('Relancer M. Agbeko', 'Fait.'));
    await runTask('org_kya', String(third.body.turn));
    const task = await taskOf(String(third.body.turn));
    const { rows } = await db.owner.query(
      `select status from ${db.schema}.kete_drafts where draft_id = $1`,
      [task.draft_ids[0]],
    );
    expect(rows[0]).toEqual({ status: 'validated' });
  });

  it('expires after ten minutes when its routine asked it: nothing leaves', async () => {
    expect(
      (
        await post(t.kofi, `/threads/agents/${ids.agent}/job`, {
          routine: { time: '07:30', cadence: 'weekdays', instruction: 'Relance ce qui est échu.' },
        })
      ).status,
    ).toBe(403);
    const set = await post(t.awa, `/threads/agents/${ids.agent}/job`, {
      routine: { time: '07:30', cadence: 'weekdays', instruction: 'Relance ce qui est échu.' },
      computerMinutes: 30,
    });
    expect(set.status).toBe(200);
    const now = await post(t.awa, `/threads/agents/${ids.agent}/routine/now`);
    const taskId = String(now.body.taskId);
    useTaskModel(proposes('Relancer la Pharmacie du Port', 'Une relance prête.'));
    // Its earlier policy would decide it: turned off, so that the request waits for her.
    await db.owner.query(
      `update ${db.schema}.kete_policies set status = 'off' where policy_id = $1`,
      [`agent.${ids.agent}.actions_propose`],
    );
    await runTask('org_kya', taskId);
    const task = await taskOf(taskId);
    await db.owner.query(
      `update ${db.schema}.kete_drafts set created_at = now() - interval '11 minutes' where draft_id = $1`,
      [task.draft_ids[0]],
    );
    const late = await post(t.awa, `/threads/requests/${task.draft_ids[0]}/once`);
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('expired');
    const { rows } = await db.owner.query(
      `select status from ${db.schema}.kete_drafts where draft_id = $1`,
      [task.draft_ids[0]],
    );
    expect(rows[0]).toEqual({ status: 'refused' });
    const side = (await view(t.awa, ids.thread)).agent;
    expect(side).toMatchObject({ computerMinutes: 30, routine: { time: '07:30' } });
  });
});

describe('it takes on her holdings as its job description says (FR-016)', () => {
  it('proposes to take a holding it covers; she hands it over, and the holding stays hers', async () => {
    await post(t.awa, `/threads/agents/${ids.agent}/job`, {
      covers: ['relance'],
      takeOn: { described: 'proposes', other: 'never', mention: 'proposes' },
    });
    ids.group = String(
      (
        (
          await post(t.awa, '/threads', {
            kind: 'group',
            title: 'Recouvrement',
            members: [{ kind: 'person', id: 'usr_kofi' }],
          })
        ).body.thread as { id: string }
      ).id,
    );
    const given = await post(t.kofi, `/threads/${ids.group}/messages`, {
      text: 'Relance le Garage Bè avant vendredi.',
      for: 'action',
      to: { kind: 'person', id: 'usr_awa' },
    });
    const holdingId = String(given.body.holdingId);
    const v = await view(t.awa, ids.group);
    const offer = (v.proposals[String((given.body.message as { id: string }).id)] ?? []).find(
      (p) => p.kind === 'takeon',
    );
    expect(offer?.body).toMatchObject({ agentName: 'Agent Relances', holdingId });
    expect((await post(t.kofi, `/threads/proposals/${offer?.proposalId}/takeon`)).status).toBe(404);
    expect((await post(t.awa, `/threads/proposals/${offer?.proposalId}/takeon`)).status).toBe(201);
    const { rows } = await db.owner.query(
      `select holder_id, delegate_id from ${db.schema}.kete_holdings where holding_id = $1`,
      [holdingId],
    );
    expect(rows[0]).toEqual({ holder_id: 'usr_awa', delegate_id: ids.agent });
    expect((await view(t.awa, ids.group)).turn?.turnId).toMatch(/^tsk_/);
  });

  it('takes it alone when she said so, and never what it does not cover', async () => {
    await post(t.awa, `/threads/agents/${ids.agent}/job`, { takeOn: { described: 'alone' } });
    const covered = await post(t.kofi, `/threads/${ids.group}/messages`, {
      text: 'Relance la Clinique Biasa.',
      for: 'action',
      to: { kind: 'person', id: 'usr_awa' },
    });
    const other = await post(t.kofi, `/threads/${ids.group}/messages`, {
      text: 'Prépare le planning de novembre.',
      for: 'action',
      to: { kind: 'person', id: 'usr_awa' },
    });
    const { rows } = await db.owner.query(
      `select holding_id, delegate_id from ${db.schema}.kete_holdings where holding_id = any($1)`,
      [[covered.body.holdingId, other.body.holdingId]],
    );
    const delegate = Object.fromEntries(rows.map((r) => [r.holding_id, r.delegate_id]));
    expect(delegate[String(covered.body.holdingId)]).toBe(ids.agent);
    expect(delegate[String(other.body.holdingId)]).toBeNull();
    const v = await view(t.awa, ids.group);
    expect(
      v.messages.some((m) => m.author.id === ids.agent && m.text.includes('s’en charge')),
    ).toBe(true);
  });

  it('sets to work where it is mentioned, unless it never does', async () => {
    const asked = await post(t.awa, `/threads/${ids.group}/messages`, {
      text: '@Agent Relances, fais le point des relances.',
      mentions: [{ kind: 'agent', id: ids.agent }],
    });
    expect(String(asked.body.turn)).toMatch(/^tsk_/);
    await post(t.awa, `/threads/agents/${ids.agent}/job`, { takeOn: { mention: 'never' } });
    const quiet = await post(t.awa, `/threads/${ids.group}/messages`, {
      text: '@Agent Relances, rien.',
      mentions: [{ kind: 'agent', id: ids.agent }],
    });
    expect(quiet.body.turn).toBeNull();
  });
});

describe('an agent from one sentence (FR-017)', () => {
  it('starts on trial: it only proposes', async () => {
    const created = await post(t.awa, '/agents', {
      name: 'Agent Factures',
      kind: 'personal',
      mission: 'Préparer les factures.',
      permissions: ['meetings:manage'],
      autonomyMax: 3,
      watches: ['decisions'],
      fromSentence: true,
    });
    expect(created.status).toBe(201);
    const { rows } = await db.owner.query(
      `select autonomy_max, trial_until > now() as on_trial from ${db.schema}.agents where agent_id = $1`,
      [created.body.agentId],
    );
    expect(rows[0]).toEqual({ autonomy_max: 2, on_trial: true });
  });
});
