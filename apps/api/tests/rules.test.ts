import type { TestSchema } from '@kete/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runTask, useTaskModel } from '../src/features/agents/index.js';
import { engine } from '../src/features/policies/index.js';
import { ruleText } from '../src/features/rules/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 068 (doctrine D-043): an organization's rule for its agents is a sentence applied at one
// point of passage. Born on trial, it only counts; tried on the last month, it is switched on;
// then it refuses the gesture, and the journal names the rule that refused.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '' };
const ids = {} as Record<'awa' | 'agent' | 'rule', string>;
let key = 0;
const SENTENCE = 'Aucun agent ne prépare ni ne modifie les actions des réunions.';

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `rules-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
/** A model that prepares an action of a meeting, then says what happened. */
const proposes = () =>
  new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'actions_propose',
            input: JSON.stringify({
              title: 'Relancer le client Mensah',
              responsiblePersonId: ids.awa,
              dueOn: '2026-11-15',
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      },
      { content: [{ type: 'text', text: 'Voilà.' }], finishReason: stop, usage, warnings: [] },
    ],
  });

type Task = {
  taskId: string;
  status: string;
  steps: { tool: string; status: string; rule?: string }[];
  draftIds: string[];
};
/** She gives her agent the task, and it runs. */
async function works(): Promise<Task> {
  const given = await post(t.awa, `/agents/${ids.agent}/tasks`, {
    instruction: 'Prépare l’action de relancer le client Mensah.',
  });
  const taskId = (given.body.task as Task).taskId;
  useTaskModel(proposes());
  expect(await runTask('org_kya', taskId)).toBe('done');
  return (await get(t.awa, `/agents/tasks/${taskId}`)).body.task as Task;
}
const rulesOf = async () =>
  (await get(t.admin, '/rules')).body.rules as {
    ruleId: string;
    state: string;
    sentence: string;
    effect: string;
    lastMonth: { refused: number; counted: number };
  }[];
const journal = async () =>
  (await get(t.admin, '/rules/refusals')).body.refusals as {
    rule: string;
    trial: boolean;
    agentId: string;
    onBehalfOf: string | null;
    channel: string;
    tool: string;
    permission: string;
  }[];

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  await post(t.admin, '/organization/modules', { module: 'meetings', enabled: true });
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Agence de Lomé',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  const position = (
    await post(t.admin, '/structure/positions', {
      unitId: unit,
      title: 'Commerciale',
      startsOn: '2026-01-01',
    })
  ).body.positionId;
  ids.awa = String(
    (await post(t.admin, '/structure/people', { name: 'Awa', accountUserId: 'usr_awa' })).body
      .personId,
  );
  await post(t.admin, '/structure/assignments', {
    personId: ids.awa,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  const role = (
    await post(t.admin, '/rights/roles', { name: 'Réunions', permissions: ['meetings:manage'] })
  ).body.roleId;
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: position,
    startsOn: '2026-01-01',
  });
  ids.agent = String(
    (
      await post(t.awa, '/agents', {
        name: 'Agent de suivi',
        kind: 'personal',
        mission: 'Préparer les actions de mes réunions.',
        permissions: ['meetings:manage'],
        autonomyMax: 3,
        draftBudget: 10,
        watches: ['decisions'],
      })
    ).body.agentId,
  );
});

afterAll(async () => {
  useTaskModel(undefined);
  await db?.drop();
});

describe('a rule refuses a gesture and the journal names it', () => {
  it('is written by an administrator, in a family that is applied, on trial', async () => {
    const rule = { family: 'tools', sentence: SENTENCE, permissions: ['meetings:manage'] };
    expect((await post(t.awa, '/rules', rule)).status).toBe(403);
    expect((await get(t.awa, '/rules')).status).toBe(403);
    expect((await post(t.admin, '/rules', { ...rule, permissions: [] })).status).toBe(422);
    expect(
      (await post(t.admin, '/rules', { ...rule, permissions: ['treasury:pay'] })).body,
    ).toMatchObject({
      error: 'unknown_permission',
    });
    expect((await post(t.admin, '/rules', { ...rule, family: 'retention' })).body).toMatchObject({
      error: 'family_later',
    });
    const created = await post(t.admin, '/rules', rule);
    expect(created).toMatchObject({
      status: 201,
      body: { rule: { state: 'trial', effect: 'forbid', sentence: SENTENCE } },
    });
    ids.rule = (created.body.rule as { ruleId: string }).ruleId;
  });

  it('refuses nothing on trial: it counts what it would have refused', async () => {
    const task = await works();
    expect(task.steps).toMatchObject([{ tool: 'actions_propose', status: 'draft' }]);
    expect(task.draftIds).toHaveLength(1);
    expect(await journal()).toMatchObject([
      { rule: SENTENCE, trial: true, agentId: ids.agent, tool: 'actions_propose' },
    ]);
    expect((await rulesOf())[0]?.lastMonth).toEqual({ refused: 0, counted: 1 });
  });

  it('is switched on only once it was tried on the last month', async () => {
    const on = { state: 'active' };
    expect((await post(t.admin, `/rules/${ids.rule}/state`, on)).body).toMatchObject({
      error: 'not_tried',
    });
    const tried = await post(t.admin, `/rules/${ids.rule}/simulate`);
    expect(tried.body.simulation).toMatchObject({
      days: 30,
      steps: 1,
      refused: 1,
      examples: [{ agent: 'Agent de suivi', tool: 'actions_propose' }],
    });
    expect((await post(t.awa, `/rules/${ids.rule}/state`, on)).status).toBe(403);
    expect((await post(t.admin, `/rules/${ids.rule}/state`, on)).body).toMatchObject({
      before: 'trial',
      state: 'active',
    });
  });

  it('refuses the agent’s gesture once active, and the journal names the rule', async () => {
    const task = await works();
    // Nothing was prepared: the step is refused, and says by which rule.
    expect(task.steps).toEqual([
      expect.objectContaining({ tool: 'actions_propose', status: 'refused', rule: SENTENCE }),
    ]);
    expect(task.draftIds).toEqual([]);
    expect((await journal())[0]).toEqual(
      expect.objectContaining({
        rule: SENTENCE,
        trial: false,
        agentId: ids.agent,
        onBehalfOf: 'usr_awa',
        channel: 'worker',
        tool: 'actions_propose',
        permission: 'meetings:manage',
      }),
    );
    expect((await rulesOf())[0]?.lastMonth).toEqual({ refused: 1, counted: 1 });
    // « Comment ? » shows it to her.
    const how = (await get(t.awa, `/agents/tasks/${task.taskId}/how`)).body.steps as Task['steps'];
    expect(how[0]).toMatchObject({ status: 'refused', rule: SENTENCE });
  });

  it('refuses her copilot through the MCP gateway the same way', async () => {
    const client = new Client({ name: 'copilot-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('https://api.kete.test/mcp'), {
        requestInit: {
          headers: { authorization: `Bearer ${t.awa}`, 'user-agent': 'copilot-test' },
        },
        fetch: async (url, init) => api.request(url.toString(), init),
      }),
    );
    const before = (await journal()).length;
    const answer = (await client.callTool({
      name: 'actions_propose',
      arguments: {
        title: 'Relancer le client Mensah',
        responsiblePersonId: ids.awa,
        dueOn: '2026-11-15',
      },
    })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toContain(SENTENCE);
    const after = await journal();
    expect(after).toHaveLength(before + 1);
    expect(after[0]).toMatchObject({ agentId: 'agt_gateway', channel: 'mcp', trial: false });
    await client.close();
  });

  it('never refuses a person’s own gesture', async () => {
    // The draft prepared while the rule was on trial is hers to decide, rule or not.
    const { rows } = await db.owner.query<{ draft_id: string }>(
      `select draft_id from ${db.schema}.kete_drafts where status = 'prepared'`,
    );
    expect(rows).toHaveLength(1);
    const decided = await post(t.awa, `/assistant/drafts/${rows[0]?.draft_id ?? ''}/decide`, {
      action: 'validate',
    });
    expect(decided.status).toBeLessThan(300);
  });

  it('lets the agents work again once switched off', async () => {
    await post(t.admin, `/rules/${ids.rule}/state`, { state: 'off' });
    const task = await works();
    expect(task.steps).toMatchObject([{ tool: 'actions_propose', status: 'draft' }]);
  });

  it('covers acting alone only, for a rule on autonomy', () => {
    // The rule's policy, decided by the engine as the gateway asks it.
    const refuses = (permissions: string[], permission: string, autonomy: number) =>
      engine.decide({
        policies: [
          {
            id: 'rul_00000000-test',
            version: 1,
            sentence: 'Personne seule',
            rule: ruleText({ effect: 'person', permissions }),
            set: 'authority',
            owner: 'usr_ama',
            status: 'active',
          },
        ],
        gesture: {
          actor: { kind: 'agent', id: 'agt_x', on_behalf_of: 'usr_awa' },
          kind: 'capability.use',
          object: { kind: 'capability', id: 'actions_propose' },
          context: { permission, autonomy },
          at: '2026-10-16T10:00:00Z',
        },
        entities: [],
      }).effect === 'refuse';
    expect(refuses([], 'meetings:manage', 1)).toBe(false);
    expect(refuses([], 'meetings:manage', 2)).toBe(true);
    expect(refuses([], 'meetings:manage', 3)).toBe(false);
    expect(refuses(['registry:read'], 'meetings:manage', 2)).toBe(false);
  });
});
