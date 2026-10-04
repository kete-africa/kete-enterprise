import { readJournal } from '@kete/commands';
import { inOrganization } from '@kete/tenancy';
import type { TestSchema } from '@kete/testing';
import type { TranscriptionModel } from 'ai';
import { MockLanguageModelV4, MockTranscriptionModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useOrganizationModels } from '../src/platform/models.js';
import { startApi, tokenFor } from './support.js';

// Spec 035: a meeting's record prepared from what was said — its recording transcribed and not
// kept, or its transcript pasted — the model proposing notes and decisions with their owners and
// deadlines, the person who runs the meeting correcting and publishing them as hers.

let db: TestSchema;
const api = createApi();
const t = { admin: '', secretary: '', kofi: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `records-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const id = (answer: { body: Answer }, field: string) => String(answer.body[field] ?? '');

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
/** A transcription model answering in memory (its stream part is not needed here). */
const transcriber = (options: ConstructorParameters<typeof MockTranscriptionModelV4>[0]) =>
  new MockTranscriptionModelV4(options) as unknown as TranscriptionModel;

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  t.secretary = await tokenFor('usr_secretary');
  t.kofi = await tokenFor('usr_kofi');
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
  const position = async (title: string) =>
    id(
      await post(t.admin, '/structure/positions', {
        unitId: top,
        title,
        startsOn: '2026-01-01',
      }),
      'positionId',
    );
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
  ids.secPos = await position('Assistante de direction');
  ids.kofiPos = await position('Directeur Technique');
  ids.sec = await person('Akossiwa', ids.secPos, 'usr_secretary');
  ids.kofi = await person('Kofi Mensah', ids.kofiPos, 'usr_kofi');
  const role = id(
    await post(t.admin, '/rights/roles', { name: 'Secrétariat', permissions: ['meetings:manage'] }),
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: ids.secPos,
    startsOn: '2026-01-01',
  });
  ids.type = id(
    await post(t.secretary, '/meetings/types', { name: 'Revue SAV', kind: 'operations' }),
    'typeId',
  );
  ids.meeting = id(
    await post(t.secretary, '/meetings/meetings', {
      typeId: ids.type,
      startsAt: '2026-10-06T08:00:00Z',
    }),
    'meetingId',
  );
  await post(t.secretary, `/meetings/meetings/${ids.meeting}/hold`, {
    presentPersonIds: [ids.sec, ids.kofi],
  });
});

afterAll(async () => {
  useOrganizationModels({});
  await db?.drop();
});

describe("a meeting's record, prepared from what was said", () => {
  it('transcribes its recording without keeping it, for who runs meetings only', async () => {
    const audio = Buffer.from('fake audio').toString('base64');
    expect(
      (
        await post(t.kofi, `/meetings/meetings/${ids.meeting}/transcript`, {
          audio,
          contentType: 'audio/webm',
        })
      ).status,
    ).toBe(403);
    useOrganizationModels({ transcription: null });
    expect(
      (
        await post(t.secretary, `/meetings/meetings/${ids.meeting}/transcript`, {
          audio,
          contentType: 'audio/webm',
        })
      ).body,
    ).toMatchObject({ error: 'transcription_unavailable' });
    useOrganizationModels({
      transcription: transcriber({
        doGenerate: async () => ({
          text: 'Kofi propose de remplacer les onduleurs de Lomé avant le 15 novembre. Accord.',
          segments: [],
          language: 'fr',
          durationInSeconds: 42,
          warnings: [],
          response: { timestamp: new Date(), modelId: 'mock' },
        }),
      }),
    });
    const transcribed = await post(t.secretary, `/meetings/meetings/${ids.meeting}/transcript`, {
      audio,
      contentType: 'audio/webm',
    });
    expect(transcribed).toMatchObject({
      status: 201,
      body: { transcript: { source: 'audio', text: expect.stringContaining('onduleurs') } },
    });
    const { rows } = await db.owner.query(
      `select text from ${db.schema}.meeting_transcripts where meeting_id = $1`,
      [ids.meeting],
    );
    expect(rows[0]?.text).toContain('onduleurs');
  });

  it('proposes notes and decisions, owners only among those present', async () => {
    useOrganizationModels({ language: null });
    expect(
      (await post(t.secretary, `/meetings/meetings/${ids.meeting}/prepare`)).body,
    ).toMatchObject({ error: 'assistant_unavailable' });
    useOrganizationModels({
      language: new MockLanguageModelV4({
        doGenerate: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                notes: '## Onduleurs\nRemplacement décidé.',
                decisions: [
                  {
                    text: 'Remplacer les onduleurs de Lomé',
                    responsiblePersonId: ids.kofi,
                    dueOn: '2026-11-15',
                    idea: false,
                  },
                  {
                    text: 'Former un technicien',
                    responsiblePersonId: 'prs_00000000-0000-0000-0000-000000000000',
                    dueOn: 'bientôt',
                    idea: false,
                  },
                ],
              }),
            },
          ],
          finishReason: stop,
          usage,
          warnings: [],
        },
      }),
    });
    const prepared = await post(t.secretary, `/meetings/meetings/${ids.meeting}/prepare`);
    expect(prepared.body).toMatchObject({
      proposal: {
        notes: expect.stringContaining('Onduleurs'),
        decisions: [
          {
            text: 'Remplacer les onduleurs de Lomé',
            responsiblePersonId: ids.kofi,
            dueOn: '2026-11-15',
          },
          // Someone absent, a deadline not a date: left for the person to set.
          { text: 'Former un technicien', responsiblePersonId: null, dueOn: null },
        ],
      },
    });
    expect(
      (await call(t.secretary, 'GET', `/meetings/meetings/${ids.meeting}/transcript`)).body,
    ).toMatchObject({ transcript: { proposal: { notes: expect.stringContaining('Onduleurs') } } });
  });

  it('records what the person validated, as hers: decisions, actions, the record on time', async () => {
    const recorded = await post(t.secretary, `/meetings/meetings/${ids.meeting}/record`, {
      notes: '## Onduleurs\nRemplacement décidé.',
      decisions: [
        {
          text: 'Remplacer les onduleurs de Lomé',
          responsiblePersonId: ids.kofi,
          dueOn: '2026-11-15',
        },
      ],
    });
    expect(recorded).toMatchObject({
      status: 201,
      body: {
        published: { onTime: true },
        decisions: [{ actionId: expect.stringMatching(/^act_/) }],
      },
    });
    const actions = (await call(t.kofi, 'GET', '/actions')).body.actions as { title: string }[];
    expect(actions.map((a) => a.title)).toContain('Remplacer les onduleurs de Lomé');
    const journal = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'publish-record' }),
    );
    expect(journal[0]).toMatchObject({ actor: { kind: 'person', id: 'usr_secretary' } });
    expect(
      (await post(t.secretary, `/meetings/meetings/${ids.meeting}/prepare`)).body,
    ).toMatchObject({ error: 'wrong_step' });
  });
});
