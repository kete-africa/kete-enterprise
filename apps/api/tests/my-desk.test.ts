import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runTask, useAgentModel, useTaskModel } from '../src/features/agents/index.js';
import { useCardReader } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 067 (doctrine D-044): an agent born of a sentence is tried before it exists — its dry run
// says what it would signal, and its first round raises exactly that. « Mon accueil » says what
// arrives at a person and who takes care of it: a rule of hers hands a request to her own agent,
// which prepares; she still signs what goes back; away, her requests go to a colleague.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '', esi: '' };
const ids = {} as Record<'quotes' | 'awaAgent', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `desk-key-${++key}`,
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
const answers = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });

type Request = {
  requestId: string;
  status: string;
  to: { userId: string; name: string };
  agent: { name: string; work: string | null } | null;
  returned: { text: string; signedBy: string; preparedBy: string | null } | null;
  events: { kind: string; actor: { kind: string; name: string }; text: string }[];
};
const ask = async (token: string, colleague: string, title: string, detail = '') =>
  (await post(token, '/requests', { colleague, title, ...(detail ? { detail } : {}) })).body
    .request as Request;
const read = async (token: string, requestId: string) =>
  (await get(token, `/requests/${requestId}`)).body.request as Request;
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await startApi();
  // No app has an identity card: the registry's watch has something to say.
  useCardReader(async () => null);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi Dossou' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Service après-vente',
      startsOn: '2026-01-01',
    })
  ).body.unitId as string;
  const position = async (title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
  const assign = async (name: string, accountUserId: string, positionId: string) => {
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  };
  // Esi directs; Awa answers to her; Kofi answers to Awa.
  const director = await position('Directrice');
  const head = await position('Responsable SAV', director);
  await assign('Esi Dossou', 'usr_esi', director);
  await assign('Awa Mensah', 'usr_awa', head);
  await assign('Kofi Agbo', 'usr_kofi', await position('Technicien devis', head));
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  // An app without an identity card, in Awa's space.
  await post(t.awa, '/registry/resources', {
    kind: 'app',
    name: 'Caisse',
    address: 'https://caisse.example.test',
  });
  const agent = async (token: string, name: string) =>
    String(
      (
        await post(token, '/agents', {
          name,
          kind: 'personal',
          mission: 'Préparer les devis.',
          watches: ['decisions'],
        })
      ).body.agentId ?? '',
    );
  ids.quotes = await agent(t.kofi, 'Agent Devis');
  ids.awaAgent = await agent(t.awa, 'Agent Awa');
});

afterAll(async () => {
  useTaskModel(undefined);
  useAgentModel(undefined);
  await db?.drop();
});

describe('an agent created from a sentence runs after its dry run', () => {
  const countOf = async () => ((await get(t.awa, '/agents')).body.agents as unknown[]).length;

  it('is tried before it exists, and its first round raises what the dry run said', async () => {
    useAgentModel(
      answers(
        JSON.stringify({
          name: 'Veille de mes apps',
          mission: 'Signaler mes apps sans fiche d’identité.',
          watches: ['registry'],
          permissions: ['registry:read'],
          autonomyMax: 1,
          wakeEveryMinutes: 60,
          plan: ['Chaque heure, il lit le registre', 'Il vous prévient, il ne change rien'],
        }),
      ),
    );
    await post(t.admin, '/rights/roles', { name: 'Registre', permissions: ['registry:read'] });
    const before = await countOf();
    const understood = await post(t.awa, '/agents/understand', {
      sentence: 'Préviens-moi quand une de mes apps n’a pas de fiche d’identité',
    });
    const proposal = understood.body.proposal as {
      name: string;
      mission: string;
      watches: string[];
      permissions: string[];
      autonomyMax: number;
      wakeEveryMinutes: number;
    };
    expect(proposal.watches).toEqual(['registry']);
    // The dry run of what was understood — whatever permissions the proposal kept.
    const description = { watches: proposal.watches, permissions: ['registry:read'] };
    const dry = await post(t.awa, '/agents/dry-run', description);
    expect(dry.status).toBe(200);
    const said = dry.body.findings as { watch: string; kind: string; subject: string }[];
    expect(said).toEqual([{ watch: 'registry', kind: 'registry.no_card', subject: 'Caisse' }]);
    // Nothing exists yet, nothing was signalled.
    expect(await countOf()).toBe(before);
    const created = await post(t.awa, '/agents', {
      name: proposal.name,
      kind: 'personal',
      mission: proposal.mission,
      ...description,
      autonomyMax: proposal.autonomyMax,
      wakeEveryMinutes: proposal.wakeEveryMinutes,
    });
    expect(created.status).toBe(201);
    const agentId = String(created.body.agentId);
    expect((await post(t.awa, `/agents/${agentId}/wake`)).body).toMatchObject({
      acted: true,
      raised: said.length,
    });
    const agents = (await get(t.awa, '/agents')).body.agents as {
      agentId: string;
      signals: { kind: string; subject: string }[];
    }[];
    expect(
      agents
        .find((agent) => agent.agentId === agentId)
        ?.signals.map(({ kind, subject }) => ({ kind, subject })),
    ).toEqual(said.map(({ kind, subject }) => ({ kind, subject })));
  });

  it('says nothing for a watch whose permission it would not hold, and refuses nonsense', async () => {
    expect((await post(t.awa, '/agents/dry-run', { watches: ['registry'] })).body.findings).toEqual(
      [],
    );
    expect((await post(t.awa, '/agents/dry-run', { watches: [] })).status).toBe(422);
    // Read with her own rights: a colleague's space is not hers to try on.
    expect(
      (
        await post(t.kofi, '/agents/dry-run', {
          watches: ['registry'],
          permissions: ['registry:read'],
        })
      ).body.findings,
    ).toEqual([]);
  });
});

describe('« Mon accueil »', () => {
  const rulesOf = async (token: string) =>
    (await get(token, '/reception')).body.rules as {
      ruleId: string;
      words: string[];
      agent: { name: string };
      applies: boolean;
    }[];

  it('lets everything arrive at her while she set nothing', async () => {
    expect((await get(t.kofi, '/reception')).body).toEqual({ rules: [], absence: null });
    const request = await ask(t.awa, 'Kofi Agbo', 'Chiffre le devis Garage Bè');
    expect(request).toMatchObject({ status: 'received', agent: null });
  });

  it('takes a rule that names her own agent — never a colleague’s', async () => {
    expect(
      (await post(t.kofi, '/reception/rules', { words: ['devis'], agentId: ids.awaAgent })).status,
    ).toBe(403);
    // Not even one a colleague shares with her.
    await post(t.awa, `/agents/${ids.awaAgent}/sharing`, { visibility: 'shared' });
    expect(
      (await post(t.kofi, '/reception/rules', { words: ['devis'], agentId: ids.awaAgent })).status,
    ).toBe(403);
    const set = await post(t.kofi, '/reception/rules', { words: ['Devis'], agentId: ids.quotes });
    expect(set.status).toBe(201);
    expect(await rulesOf(t.kofi)).toMatchObject([
      { words: ['Devis'], agent: { name: 'Agent Devis' }, applies: true },
    ]);
    // Hers alone: who asks her never reads it.
    expect(await rulesOf(t.awa)).toEqual([]);
  });

  it('hands a request her rule covers to her agent, which prepares — and she still signs', async () => {
    const request = await ask(
      t.awa,
      'Kofi Agbo',
      'Garage Bè',
      'Un DEVIS pour huit batteries, pose comprise.',
    );
    expect(request).toMatchObject({
      status: 'taken',
      agent: { name: 'Agent Devis', work: 'queued' },
    });
    const { rows } = await db.owner.query<{ task_id: string }>(
      `select task_id from ${db.schema}.agent_tasks where agent_id = $1 and status = 'queued'`,
      [ids.quotes],
    );
    useTaskModel(answers('Devis Garage Bè : 2 480 000 F CFA HT.'));
    expect(await runTask('org_kya', rows[0]?.task_id ?? '')).toBe('done');
    // Who asked sees a state — that an agent worked — never what it prepared, nor her rule.
    const hers = await read(t.awa, request.requestId);
    expect(hers.returned).toBeNull();
    expect(hers.events.map((event) => event.kind)).toEqual(['asked', 'handed', 'agent_done']);
    expect(hers.events.at(-1)?.text).toBe('');
    // The hand-over is hers, by her rule; what goes back is signed by her.
    const his = await read(t.kofi, request.requestId);
    expect(his.events[1]).toMatchObject({ actor: { kind: 'person', name: 'Kofi Agbo' } });
    expect(his.events[1]?.text).toContain('Devis');
    const returned = await post(t.kofi, `/requests/${request.requestId}/moves`, {
      kind: 'return',
      text: 'Devis Garage Bè : 2 480 000 F CFA HT.',
    });
    expect(returned.body.request).toMatchObject({
      status: 'returned',
      returned: { signedBy: 'usr_kofi', preparedBy: ids.quotes },
    });
  });

  it('says what would become of a request, without writing anything', async () => {
    const trial = async (title: string) =>
      (await post(t.kofi, '/reception/try', { title })).body.trial;
    expect(await trial('Un devis pour Mme Adjovi')).toEqual({
      handledBy: { kind: 'agent', name: 'Agent Devis', word: 'Devis' },
      returns: 'signed',
    });
    expect(await trial('Tes disponibilités jeudi')).toEqual({
      handledBy: { kind: 'me' },
      returns: 'signed',
    });
  });

  it('gives way to the organization’s kill switch, and to a paused agent', async () => {
    await post(t.admin, '/organization/modules', { module: 'agents', enabled: false });
    expect(await rulesOf(t.kofi)).toMatchObject([{ applies: false }]);
    expect(await ask(t.awa, 'Kofi Agbo', 'Un devis de plus')).toMatchObject({
      status: 'received',
      agent: null,
    });
    await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
    await post(t.kofi, `/agents/${ids.quotes}/status`, { status: 'paused' });
    expect(await ask(t.awa, 'Kofi Agbo', 'Encore un devis')).toMatchObject({
      status: 'received',
      agent: null,
    });
    await post(t.kofi, `/agents/${ids.quotes}/status`, { status: 'active' });
    const rule = (await rulesOf(t.kofi))[0];
    expect(rule?.applies).toBe(true);
    expect(
      (await post(t.kofi, `/reception/rules/${rule?.ruleId ?? ''}/remove`)).body.rules,
    ).toEqual([]);
  });

  it('sends her requests to the colleague she named while she is away', async () => {
    // A colleague the directory shows her — and never herself.
    expect(
      (
        await post(t.awa, '/reception/absence', {
          startsOn: day(0),
          endsOn: day(3),
          colleague: 'Personne',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(t.awa, '/reception/absence', {
          startsOn: day(0),
          endsOn: day(3),
          colleague: 'Awa Mensah',
        })
      ).status,
    ).toBe(422);
    const set = await post(t.awa, '/reception/absence', {
      startsOn: day(0),
      endsOn: day(3),
      colleague: 'Kofi Agbo',
    });
    expect(set.body.absence).toMatchObject({ delegate: { userId: 'usr_kofi' }, endsOn: day(3) });
    const request = await ask(t.esi, 'Awa Mensah', 'Le point SAV du mois');
    expect(request.to).toEqual({ userId: 'usr_kofi', name: 'Kofi Agbo' });
    const thread = await read(t.esi, request.requestId);
    expect(thread.events.map((event) => event.kind)).toEqual(['asked', 'note']);
    expect(thread.events[1]).toMatchObject({ actor: { name: 'Awa Mensah' } });
    expect(thread.events[1]?.text).toContain('Kofi Agbo');
    expect(JSON.stringify((await get(t.kofi, '/workspace/tasks')).body)).toContain(
      'Le point SAV du mois',
    );
    // Never back to who asks: Kofi asking Awa still reaches Awa.
    expect((await ask(t.kofi, 'Awa Mensah', 'Valide mon congé')).to.userId).toBe('usr_awa');
    // Back, everything arrives at her again.
    expect((await post(t.awa, '/reception/absence/clear')).body.absence).toBeNull();
    expect((await ask(t.esi, 'Awa Mensah', 'Le budget 2027')).to.userId).toBe('usr_awa');
  });

  it('does not start an absence that is not today’s', async () => {
    await post(t.awa, '/reception/absence', {
      startsOn: day(5),
      endsOn: day(9),
      colleague: 'Kofi Agbo',
    });
    expect((await ask(t.esi, 'Awa Mensah', 'Avant son congé')).to.userId).toBe('usr_awa');
    expect(
      (
        await post(t.awa, '/reception/absence', {
          startsOn: day(9),
          endsOn: day(5),
          colleague: 'Kofi Agbo',
        })
      ).status,
    ).toBe(422);
  });
});
