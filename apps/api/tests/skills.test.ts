import { readSkillArchive, skillArchive, skillFromText } from '@kete/skills';
import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { commandInstructions, useModel } from '../src/features/assistant/index.js';
import { useSkillsModel } from '../src/features/skills/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 031: the know-how the assistant reads as Agent Skills — shipped ones for the chat's commands,
// the organization's kept from Claude, ChatGPT or a conversation, opened by administrators, versioned,
// exported, checked by their own cases.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '' };
let key = 0;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
const answering = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: { content: [{ type: 'text', text }], finishReason: stop, usage, warnings: [] },
  });

const relance = (body = 'Rappeler la date et le montant, proposer un appel.') =>
  skillFromText({
    'SKILL.md': `---\nname: relance-client\ndescription: Relance un client en retard de paiement, au ton maison. À utiliser pour toute relance.\n---\n\n1. ${body}\n`,
    'evals/evals.json': JSON.stringify([
      {
        prompt: 'Relance la société Mensah pour la facture 42.',
        expectations: ['Cite la facture 42'],
      },
    ]),
  });
const zip = (skill = relance()) => Buffer.from(skillArchive(skill)).toString('base64');

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `skills-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const type = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: type.includes('json') ? ((await response.json()) as Answer) : {},
    bytes: type.includes('json') ? null : new Uint8Array(await response.arrayBuffer()),
  };
}

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
});

afterAll(async () => {
  useSkillsModel(undefined);
  useModel(undefined);
  await db?.drop();
});

describe('shipped skills', () => {
  it("are the chat's commands, read from their SKILL.md", async () => {
    const [summarize] = await commandInstructions([
      { type: 'command', label: 'Résumer', id: 'summarize' },
    ]);
    expect(summarize).toContain('trois à sept points');
    expect(await commandInstructions([{ type: 'command', label: 'x', id: 'nope' }])).toEqual([]);
  });
});

describe("the organization's skills", () => {
  let skillId = '';

  it('answer only when their module is on, with the shipped ones listed', async () => {
    expect((await call(t.ama, 'GET', '/skills')).body).toMatchObject({ error: 'module_disabled' });
    await call(t.admin, 'POST', '/organization/modules', { module: 'skills', enabled: true });
    const listed = (await call(t.ama, 'GET', '/skills')).body;
    expect((listed.shipped as { name: string }[]).map((s) => s.name).sort()).toEqual([
      'actions',
      'expliquer',
      'rediger',
      'resumer',
      'tableau',
    ]);
  });

  it('are kept from a .zip, opened to their author alone', async () => {
    const kept = await call(t.ama, 'POST', '/skills', { data: zip() });
    expect(kept).toMatchObject({
      status: 201,
      body: { skills: [{ name: 'relance-client', audience: ['user:usr_ama'] }] },
    });
    skillId = ((kept.body.skills as { skillId: string }[])[0] as { skillId: string }).skillId;
    expect((await call(t.kofi, 'GET', '/skills')).body.skills).toEqual([]);
    expect((await call(t.kofi, 'GET', `/skills/${skillId}`)).status).toBe(404);
    expect((await call(t.admin, 'GET', '/skills')).body.skills).toHaveLength(1);
    // Neither a shipped name nor another person's skill can be taken.
    const shipped = skillFromText({
      'SKILL.md': '---\nname: resumer\ndescription: Une autre façon de résumer les choses.\n---\nx',
    });
    expect((await call(t.ama, 'POST', '/skills', { data: zip(shipped) })).body).toMatchObject({
      error: 'skill_name_taken',
    });
    expect((await call(t.kofi, 'POST', '/skills', { data: zip() })).body).toMatchObject({
      error: 'skill_name_taken',
    });
    expect((await call(t.ama, 'POST', '/skills', { data: 'bm90IGEgemlw' })).body).toMatchObject({
      error: 'skill_invalid',
    });
  });

  it('are opened to others by an administrator, never by their author', async () => {
    expect(
      (await call(t.ama, 'POST', `/skills/${skillId}`, { audience: ['everyone'] })).status,
    ).toBe(403);
    await call(t.admin, 'POST', `/skills/${skillId}`, { audience: ['everyone'] });
    expect((await call(t.kofi, 'GET', `/skills/${skillId}`)).body).toMatchObject({
      skill: { name: 'relance-client' },
      manage: false,
      cases: 1,
    });
  });

  it('keep every version, export the current one, bring an older one back', async () => {
    const first = (await call(t.ama, 'GET', `/skills/${skillId}`)).body.skill as {
      version: string;
    };
    await call(t.ama, 'POST', '/skills', { data: zip(relance('Vouvoyer, rappeler la date.')) });
    const read = (await call(t.ama, 'GET', `/skills/${skillId}`)).body;
    expect((read.versions as unknown[]).length).toBe(2);
    expect(read.instructions).toContain('Vouvoyer');
    const exported = await call(t.kofi, 'GET', `/skills/${skillId}/archive`);
    expect(readSkillArchive(exported.bytes as Uint8Array)[0]?.name).toBe('relance-client');
    await call(t.ama, 'POST', `/skills/${skillId}`, { version: first.version });
    expect((await call(t.ama, 'GET', `/skills/${skillId}`)).body.instructions).toContain(
      'Rappeler la date et le montant',
    );
  });

  it('are checked against their own cases, a judge ruling on each expectation', async () => {
    useSkillsModel(null);
    expect((await call(t.ama, 'POST', `/skills/${skillId}/evaluate`)).body).toMatchObject({
      error: 'assistant_unavailable',
    });
    let round = 0;
    useSkillsModel(
      new MockLanguageModelV4({
        doGenerate: async () =>
          round++ % 2 === 0
            ? {
                content: [{ type: 'text', text: 'Madame, la facture 42…' }],
                finishReason: stop,
                usage,
                warnings: [],
              }
            : {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      verdicts: [{ expectation: 'Cite la facture 42', met: true, reason: 'Oui.' }],
                    }),
                  },
                ],
                finishReason: stop,
                usage,
                warnings: [],
              },
      }),
    );
    expect((await call(t.ama, 'POST', `/skills/${skillId}/evaluate`)).body).toMatchObject({
      report: { passed: 1, total: 1 },
    });
  });

  it('are kept from a conversation that worked, written by the model', async () => {
    await db.owner.query(
      `insert into ${db.schema}.assistant_conversations (conversation_id, organization_id, user_id, title)
       values ('cnv_00000000-0000-0000-0000-0000000000bb', 'org_kya', 'usr_kofi', 'Relance')`,
    );
    useModel(
      answering(
        JSON.stringify({
          name: 'compte-rendu-chantier',
          description:
            'Rédige le compte rendu d’une visite de chantier. À utiliser après chaque visite.',
          instructions: '1. Lister les constats.\n2. Lister les actions avec un responsable.',
        }),
      ),
    );
    const kept = await call(
      t.kofi,
      'POST',
      '/assistant/conversations/cnv_00000000-0000-0000-0000-0000000000bb/skill',
    );
    expect(kept).toMatchObject({
      status: 201,
      body: { skill: { name: 'compte-rendu-chantier', audience: ['user:usr_kofi'] } },
    });
    expect(
      (
        await call(
          t.ama,
          'POST',
          '/assistant/conversations/cnv_00000000-0000-0000-0000-0000000000bb/skill',
        )
      ).status,
    ).toBe(404);
  });
});
