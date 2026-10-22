import { randomBytes } from 'node:crypto';
import { memoryMailbox, memorySender } from '@kete/channels';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryStorage } from '@kete/files';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { settleTurns, useMailboxes, useRouterModel } from '../src/features/messages/index.js';
import { usePushSender } from '../src/features/notifications/index.js';
import { useFileStorage } from '../src/platform/storage.js';
import { startApi, tokenFor } from './support.js';

// Spec 099, Kete's door (FR-007 to FR-011): Abla heads after-sales; Kossi, her engineer, leads the
// Hôtel du Golfe's project. A scripted model plays Kete: what it proposes exists only after her
// « oui »; a rule becomes a policy simulated over thirty days; her drawer writes in her thread.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', yao: '', essi: '' };
let key = 0;
const ids = {} as Record<'party' | 'project' | 'kete' | 'group' | 'agent', string>;
const sender = memorySender();

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `door-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: Answer = {};
  try {
    parsed = JSON.parse(text) as Answer;
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed, response };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type Summary = { thread: { id: string; kind: string; title: string }; unread: number };
const list = async (token: string) =>
  (await get(token, '/threads')).body as unknown as {
    threads: Summary[];
    names: Record<string, string>;
  };
const say = (token: string, threadId: string, body: object) =>
  post(token, `/threads/${threadId}/messages`, body);

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY ??= randomBytes(32).toString('base64');
  db = await startApi();
  useFileStorage(memoryStorage());
  usePushSender(null);
  useMailboxes({ mailbox: () => memoryMailbox(), sender: () => sender });
  useRouterModel(null);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.abla = await tokenFor('usr_abla', { name: 'Abla Kpodar' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah' });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah' });
  t.essi = await tokenFor('usr_essi', { name: 'Essi Lawson' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Service après-vente',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
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
  const head = await position('Responsable SAV');
  await assign('Abla Kpodar', 'usr_abla', head);
  await assign('Kossi Amegah', 'usr_kossi', await position('Ingénieur', head));
  await assign('Yao Mensah', 'usr_yao', await position('Technicien', head));
  await assign('Essi Lawson', 'usr_essi', await position('Comptable', head));
  const roleId = (
    await post(t.admin, '/rights/roles', {
      name: 'Projets',
      permissions: ['projects:manage', 'parties:manage'],
    })
  ).body.roleId;
  await post(t.admin, '/rights/grants', { roleId, positionId: head, startsOn: '2026-01-01' });
  await post(t.admin, '/organization/modules', { module: 'dossiers', enabled: true });
  ids.party = String(
    (
      (
        await post(t.abla, '/parties', {
          name: 'Hôtel du Golfe',
          roles: ['client'],
          email: 'direction@hotel-golfe.tg',
        })
      ).body.party as { partyId: string }
    ).partyId,
  );
  ids.project = String(
    (
      (
        await post(t.abla, '/projects', {
          name: 'Climatisation Hôtel du Golfe',
          partyId: ids.party,
          lead: { userId: 'usr_kossi', name: 'Kossi Amegah' },
        })
      ).body.project as { projectId: string }
    ).projectId,
  );
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  ids.agent = String(
    (
      await post(t.abla, '/agents', {
        name: 'Agent Relances',
        kind: 'personal',
        mission: 'Relancer les impayés de mes clients.',
        watches: ['decisions'],
      })
    ).body.agentId,
  );
});

afterAll(async () => {
  useModel(undefined);
  useFileStorage(undefined);
  usePushSender(undefined);
  useMailboxes(undefined);
  useRouterModel(undefined);
  await db?.drop();
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = (reason: 'stop' | 'tool-calls') => ({
  type: 'finish' as const,
  finishReason: { unified: reason, raw: reason === 'stop' ? 'stop' : 'tool_calls' },
  usage,
});

/** Kete, scripted: it calls each tool in turn, then says `text`. */
function kete(calls: { tool: string; input: object }[], text: string) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      step += 1;
      const call = calls[step - 1];
      const chunks: object[] = call
        ? [
            { type: 'stream-start' as const, warnings: [] },
            {
              type: 'tool-call' as const,
              toolCallId: `call_${step}`,
              toolName: call.tool,
              input: JSON.stringify(call.input),
            },
            finish('tool-calls'),
          ]
        : [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'text-start' as const, id: 't1' },
            { type: 'text-delta' as const, id: 't1', delta: text },
            { type: 'text-end' as const, id: 't1' },
            finish('stop'),
          ];
      return { stream: simulateReadableStream({ chunks }) as never };
    },
  });
}

/** Kete starts to say something, then waits — until she stops it. */
function slowKete() {
  return new MockLanguageModelV4({
    doStream: async (options) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't1' });
          controller.enqueue({ type: 'text-delta', id: 't1', delta: 'Je cherche…' });
          options.abortSignal?.addEventListener('abort', () =>
            controller.error(new DOMException('stopped', 'AbortError')),
          );
        },
      }) as never,
    }),
  });
}

type Proposal = {
  proposalId: string;
  kind: string;
  state: string;
  body: Record<string, unknown>;
  agent?: { name: string; state: string };
};
type View = {
  thread: { id: string; kind: string; members: { id: string; until?: string }[] };
  messages: {
    id: string;
    first: string;
    text: string;
    author: { id: string };
    only_for?: unknown;
  }[];
  runs: Record<string, { title: string; steps: { label: string }[] }>;
  proposals: Record<string, Proposal[]>;
  pages: Record<string, { href: string; title: string }>;
  handed: { name: string; state: string }[];
  turn: { turnId: string; live: string } | null;
};
const view = async (token: string, id: string) =>
  (await get(token, `/threads/${id}`)).body as unknown as View;
const keteThread = async (token: string) =>
  ((await get(token, '/threads/kete')).body.thread as { id: string }).id;
const lastOf = (v: View) => v.messages.at(-1);

describe('one conversation with Kete (FR-007, FR-008, FR-010)', () => {
  it('turns what she says into a set of gestures, attached to its object, made only on « oui »', async () => {
    ids.kete = await keteThread(t.abla);
    useModel(
      kete(
        [
          {
            tool: 'propose_gestures',
            input: {
              summary:
                'M. Agbeko veut deux prises de plus dans la salle 3 ; il paie le solde vendredi.',
              object: { kind: 'project', id: ids.project },
              holdings: [
                {
                  what: 'Mettre à jour le devis : +2 prises, salle 3',
                  holder: 'Kossi Amegah',
                  due: '2026-10-29',
                  source: 'de votre vocal',
                },
              ],
              dates: [{ label: 'Solde promis : 462 000 F', day: '2026-10-30' }],
            },
          },
          { tool: 'hand_to_agent', input: { agent: ids.agent, part: 'Relancer le Garage Bè.' } },
        ],
        'Compte rendu posté dans le fil du projet. Je propose deux gestes.',
      ),
    );
    const said = await say(t.abla, ids.kete, { text: 'Je sors de chez M. Agbeko…' });
    expect(said.status).toBe(201);
    expect(said.body.turn).toMatch(/^trn_/);
    await settleTurns();

    const mine = await view(t.abla, ids.kete);
    const answer = lastOf(mine);
    expect(answer?.author.id).toBe('agt_assistant');
    expect(mine.runs[answer?.id ?? '']?.title).toBe('A compris et rattaché');
    const proposals = mine.proposals[answer?.first ?? ''] ?? [];
    expect(proposals.map((p) => [p.kind, p.state])).toEqual([
      ['gestures', 'proposed'],
      ['handover', 'handed'],
    ]);
    expect(proposals[1]?.agent?.name).toBe('Agent Relances');
    expect(mine.handed.map((h) => h.name)).toEqual(['Agent Relances']);

    // The account went to the project's thread, signed by her; nothing else exists yet.
    const project = (await list(t.kossi)).threads.find(
      (s) => s.thread.title === 'Climatisation Hôtel du Golfe',
    )?.thread.id as string;
    const before = await view(t.kossi, project);
    expect(lastOf(before)).toMatchObject({ author: { id: 'usr_abla' } });
    expect(lastOf(before)?.text).toContain('salle 3');
    expect(Object.keys(before.proposals)).toEqual([]);

    // Her « oui », with the priority corrected: the holding is Kossi's, it returns to her.
    const gestures = proposals[0] as Proposal;
    const yes = await post(t.abla, `/threads/proposals/${gestures.proposalId}/confirm`, {
      edits: { '0': { priority: 'high' } },
    });
    expect(yes.status).toBe(201);
    const made = yes.body.made as { holdings: string[]; dates: string[] };
    expect(made.holdings).toHaveLength(1);
    expect(made.dates).toHaveLength(1);
    const { rows } = await db.owner.query(
      `select holder_id, return_to_id, priority, due from ${db.schema}.kete_holdings where holding_id = $1`,
      [made.holdings[0]],
    );
    expect(rows[0]).toMatchObject({
      holder_id: 'usr_kossi',
      return_to_id: 'usr_abla',
      priority: 'high',
    });
    expect(
      (await post(t.abla, `/threads/proposals/${gestures.proposalId}/confirm`, {})).status,
    ).toBe(409);
    expect((await post(t.kossi, `/threads/proposals/${gestures.proposalId}/decline`)).status).toBe(
      404,
    );
  });

  it('keeps what the drawer asked, from its page, in her thread « Kete »', async () => {
    useModel(kete([], 'Elle attend la comptabilité.'));
    const response = await api.request('/v1/assistant/chat/stream', {
      method: 'POST',
      headers: { authorization: `Bearer ${t.abla}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Pourquoi cette facture n’est pas encore validée ?',
        page: { kind: 'facture', title: 'F-2026-0007', href: '/a-faire?facture=F-2026-0007' },
      }),
    });
    expect(response.status).toBe(200);
    await response.text();
    const mine = await view(t.abla, ids.kete);
    const question = mine.messages.at(-2);
    expect(question?.text).toBe('Pourquoi cette facture n’est pas encore validée ?');
    expect(mine.pages[question?.first ?? '']).toEqual({
      href: '/a-faire?facture=F-2026-0007',
      title: 'F-2026-0007',
    });
    expect(lastOf(mine)?.text).toBe('Elle attend la comptabilité.');
  });

  it('stops a turn with « Arrêter », keeping what was said', async () => {
    useModel(slowKete());
    const said = await say(t.abla, ids.kete, { text: 'Cherche-moi qui livre des gaines.' });
    const turn = String(said.body.turn);
    let live = '';
    for (let i = 0; i < 40 && !live; i += 1) {
      live =
        ((await get(t.abla, `/threads/${ids.kete}/turn`)).body.turn as { live: string } | null)
          ?.live ?? '';
      if (!live) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(live).toBe('Je cherche…');
    expect((await post(t.kossi, `/threads/turns/${turn}/stop`)).status).toBe(409);
    expect((await post(t.abla, `/threads/turns/${turn}/stop`)).status).toBe(200);
    await settleTurns();
    const mine = await view(t.abla, ids.kete);
    expect(lastOf(mine)?.text).toContain('Je cherche…');
    expect(lastOf(mine)?.text).toContain('Arrêté par Abla Kpodar');
    expect(mine.turn).toBeNull();
  });

  it('becomes a group when she invites a colleague, and a new thread « Kete » opens', async () => {
    expect(
      (await post(t.kossi, `/threads/${ids.kete}/invite`, { people: ['usr_yao'] })).status,
    ).toBe(403);
    expect(
      (await post(t.abla, `/threads/${ids.kete}/invite`, { people: ['usr_kossi'] })).status,
    ).toBe(201);
    const now = await view(t.kossi, ids.kete);
    expect(now.thread.kind).toBe('group');
    expect(now.messages.some((m) => m.text.includes('Je sors de chez M. Agbeko'))).toBe(true);
    expect(await keteThread(t.abla)).not.toBe(ids.kete);
  });
});

describe('a rule becomes a policy (FR-011, case B)', () => {
  it('reads unasked a message that gives orders, and answers its author alone', async () => {
    ids.group = String(
      (
        (
          await post(t.abla, '/threads', {
            kind: 'group',
            title: 'Après-vente',
            members: [{ kind: 'person', id: 'usr_kossi' }],
          })
        ).body.thread as { id: string }
      ).id,
    );
    useModel(
      kete(
        [
          {
            tool: 'propose_policy',
            input: {
              rule: 'Tout achat au-delà de 50 000 F passe par moi.',
              template: 'spending.above',
              amount: 50000,
              approver: 'manager',
            },
          },
          {
            tool: 'propose_gestures',
            input: {
              summary: 'Consignes',
              holdings: [{ what: 'Préparer le planning de novembre', holder: 'usr_kossi' }],
            },
          },
        ],
        'Une règle et une consigne. Je propose :',
      ),
    );
    await say(t.abla, ids.group, {
      text: 'Tout achat au-delà de 50 000 F passe par moi. @Kossi prépare le planning.',
      mentions: [{ kind: 'person', id: 'usr_kossi' }],
    });
    await settleTurns();
    const hers = await view(t.abla, ids.group);
    const answer = lastOf(hers);
    expect(answer?.only_for).toEqual({ kind: 'person', id: 'usr_abla' });
    expect(hers.runs[answer?.id ?? '']?.title).toBe('Une règle et des consignes');
    const policy = (hers.proposals[answer?.first ?? ''] ?? []).find((p) => p.kind === 'policy');
    expect(policy?.body).toMatchObject({
      template: 'spending.above',
      policy: { id: 'spending.above', set: 'approval', approver: 'manager' },
      simulation: { changed: 0 },
    });
    // Kossi sees neither the answer nor what it proposes.
    const his = await view(t.kossi, ids.group);
    expect(his.messages.some((m) => m.first === answer?.first)).toBe(false);
    expect(Object.keys(his.proposals)).toEqual([]);
    // Only an administrator adopts a policy.
    expect(
      (await post(t.abla, `/threads/proposals/${policy?.proposalId}/policy`, { how: 'adopt' }))
        .status,
    ).toBe(403);
  });

  it('says nothing when the message gives no order', async () => {
    useModel(kete([], '—'));
    const before = (await view(t.abla, ids.group)).messages.length;
    await say(t.abla, ids.group, {
      text: '@Kossi merci pour hier.',
      mentions: [{ kind: 'person', id: 'usr_kossi' }],
    });
    await settleTurns();
    expect((await view(t.abla, ids.group)).messages.length).toBe(before + 1);
  });

  it('puts the policy in force when an administrator adopts it', async () => {
    const admin = await keteThread(t.admin);
    useModel(
      kete(
        [
          {
            tool: 'propose_policy',
            input: {
              rule: 'Au-delà de 200 000 F, le manager approuve.',
              template: 'spending.above',
              amount: 200000,
              approver: 'manager',
            },
          },
        ],
        'Une règle, pas une tâche.',
      ),
    );
    await say(t.admin, admin, { text: 'Au-delà de 200 000 F, le manager approuve.' });
    await settleTurns();
    const hers = await view(t.admin, admin);
    const policy = (hers.proposals[lastOf(hers)?.first ?? ''] ?? [])[0];
    const adopted = await post(t.admin, `/threads/proposals/${policy?.proposalId}/policy`, {
      how: 'adopt',
    });
    expect(adopted.body).toEqual({ policyId: 'spending.above', status: 'active' });
    const policies = (await get(t.admin, '/policies')).body.policies as {
      id: string;
      status: string;
    }[];
    expect(policies.find((p) => p.id === 'spending.above')?.status).toBe('active');
  });
});
