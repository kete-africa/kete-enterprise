import type { TestSchema } from '@kete/testing';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApi } from '../src/app.js';
import { awayOf, runTask, useTaskModel } from '../src/features/agents/index.js';
import { useAppFetch } from '../src/features/gateway/index.js';
import { useCardReader } from '../src/features/registry/index.js';
import { transaction } from '../src/platform/db.js';
import { useStandingMandates } from '../src/platform/mandates.js';
import { startApi, tokenFor } from './support.js';

// Spec 108 (kete-core spec 150): an agent acts while its person is away. Signed in, she lets it
// act for her in her absence — the Compte Kete keeps a standing mandate; a task then reaches the
// apps its job description names, with the mandate of now. Withdrawn, it reaches them no more.

const ORG = 'org_agents_away';
let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
let key = 0;
let agentId = '';

/** The tokens the app received, in order. */
const seen: string[] = [];
const support = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'support', version: '1' });
    server.registerTool(
      'tickets_open',
      {
        description: 'The open tickets.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => ({
        content: [{ type: 'text', text: '{}' }],
        structuredContent: { rows: [{ id: 'T-1', subject: 'Onduleur' }] },
      }),
    );
    return server;
  },
  { responseMode: 'json' },
);

/** The Compte Kete, as the center sees it: grants it gives, mandates of now, withdrawals. */
const account = {
  grants: [] as { subjectToken: string; agent: { id: string; name: string } }[],
  revoked: new Set<string>(),
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `agents-away-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
/** A model that calls one tool, then answers; it keeps the tools it was given. */
const callsThenAnswers = (toolName: string, text: string) =>
  new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName, input: '{}' }],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      },
      { content: [{ type: 'text', text }], finishReason: stop, usage, warnings: [] },
    ],
  });
const answers = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: { content: [{ type: 'text', text }], finishReason: stop, usage, warnings: [] },
  });
const toolsGiven = (model: MockLanguageModelV4) =>
  (model.doGenerateCalls[0]?.tools ?? []).map((tool) => tool.name);

async function give(instruction: string): Promise<string> {
  const answer = await call(t.awa, 'POST', `/agents/${agentId}/tasks`, { instruction });
  return (answer.body.task as { taskId: string }).taskId;
}

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.awa = await tokenFor('usr_awa', { name: 'Awa', org: ORG });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi', org: ORG });
  await call(t.admin, 'POST', '/organization/modules', { module: 'agents', enabled: true });
  useCardReader(async () => ({ product: 'prd_kete_helpdesk', name: 'Support', version: '1' }));
  useAppFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    seen.push(request.headers.get('authorization') ?? '');
    return support.fetch(request);
  }) as typeof fetch);
  useStandingMandates({
    grant: async (subjectToken, agent) => {
      account.grants.push({ subjectToken, agent });
      return 'smd_awa_support';
    },
    token: async (organizationId, grant) =>
      account.revoked.has(grant) ? null : `mandate-${organizationId}-${grant}`,
    revoke: async (_organizationId, grant) => {
      account.revoked.add(grant);
      return true;
    },
  });
  await call(t.admin, 'POST', '/registry/resources', {
    kind: 'app',
    name: 'Support',
    address: 'https://support.example.test',
  });
  // The team's app, promoted to the organization (a decided promotion, spec 016).
  await db.owner.query(`update ${db.schema}.resources set tier_kind = 'organization'`);
  agentId = String(
    (
      await call(t.awa, 'POST', '/agents', {
        name: 'Veille Support',
        kind: 'personal',
        mission: 'Dire chaque matin quels tickets restent ouverts.',
        watches: ['decisions'],
      })
    ).body.agentId,
  );
  await call(t.awa, 'POST', `/threads/agents/${agentId}/job`, {
    sources: ['kete', 'prd_kete_helpdesk'],
  });
});

afterAll(async () => {
  useTaskModel(undefined);
  useAppFetch(undefined);
  useStandingMandates(undefined);
  await db?.drop();
});

describe('an agent while its person is away', () => {
  it('is let act for her by her alone, with her token as consent', async () => {
    expect((await call(t.kofi, 'POST', `/agents/${agentId}/away`, { away: true })).status).toBe(
      403,
    );
    expect((await call(t.awa, 'POST', `/agents/${agentId}/away`, { away: true })).status).toBe(201);
    expect(account.grants).toEqual([
      { subjectToken: t.awa, agent: { id: agentId, name: 'Veille Support' } },
    ]);
    const away = await transaction(ORG, (db) => awayOf(db, agentId));
    expect(away).toMatchObject({ grant: 'smd_awa_support', userId: 'usr_awa' });
    // Its side says so, and offers the team's apps for its job description.
    const threadId = String(
      (await call(t.awa, 'POST', `/threads/agents/${agentId}/thread`)).body.threadId,
    );
    const side = (await call(t.awa, 'GET', `/threads/${threadId}`)).body.agent as {
      apps: { product: string; name: string }[];
      away: { possible: boolean; since: string | null };
    };
    expect(side.apps).toEqual([{ product: 'prd_kete_helpdesk', name: 'Support' }]);
    expect(side.away.since).not.toBeNull();
  });

  it('reaches the apps its sources name, with the mandate of now', async () => {
    const taskId = await give('Quels tickets restent ouverts ?');
    const model = callsThenAnswers('support__tickets_open', 'Un ticket reste ouvert : Onduleur.');
    useTaskModel(model);
    seen.length = 0;
    expect(await runTask(ORG, taskId)).toBe('done');
    expect(toolsGiven(model)).toContain('support__tickets_open');
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([`Bearer mandate-${ORG}-smd_awa_support`]));
    const read = await call(t.awa, 'GET', `/agents/tasks/${taskId}`);
    const steps = (read.body.task as { steps: { tool: string; status: string }[] }).steps;
    expect(steps).toContainEqual(expect.objectContaining({ tool: 'support__tickets_open' }));
  });

  it('reaches no app its sources do not name', async () => {
    await call(t.awa, 'POST', `/threads/agents/${agentId}/job`, { sources: ['kete'] });
    const model = answers('Rien à signaler.');
    useTaskModel(model);
    seen.length = 0;
    expect(await runTask(ORG, await give('Et maintenant ?'))).toBe('done');
    expect(toolsGiven(model)).not.toContain('support__tickets_open');
    expect(seen).toEqual([]);
    await call(t.awa, 'POST', `/threads/agents/${agentId}/job`, {
      sources: ['kete', 'prd_kete_helpdesk'],
    });
  });

  it('withdrawn, reaches them no more — here, or at the Compte Kete', async () => {
    expect((await call(t.awa, 'POST', `/agents/${agentId}/away`, { away: false })).status).toBe(
      200,
    );
    expect(account.revoked.has('smd_awa_support')).toBe(true);
    expect(await transaction(ORG, (db) => awayOf(db, agentId))).toBeNull();
    const model = answers('Je ne peux plus lire le Support.');
    useTaskModel(model);
    seen.length = 0;
    expect(await runTask(ORG, await give('Les tickets ?'))).toBe('done');
    expect(toolsGiven(model)).not.toContain('support__tickets_open');
    expect(seen).toEqual([]);
  });

  it('cannot be let act where agents carry no mandate', async () => {
    useStandingMandates(null);
    const refused = await call(t.awa, 'POST', `/agents/${agentId}/away`, { away: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('mandates_off');
  });
});
