import type { TestSchema } from '@kete/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { datasetTools } from '../src/features/datasets/index.js';
import { tableOf } from '../src/platform/tables.js';
import { startApi, tokenFor } from './support.js';

// Spec 063: an answer that is a tool. A tool that read rows says how to show them; the chat
// streams the table and keeps it with the answer. The rows are what the code read — a scripted
// model proves the wiring, and writes none of them.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '' };
let key = 0;
let datasetId = '';

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `tables-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

async function chat(token: string, body: object) {
  const response = await api.request('/v1/assistant/chat/stream', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Answer);
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that first calls `tool` with `input`, then says `text`, streamed. */
function streamingModel(tool: string, input: object, text: string) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      step += 1;
      const chunks: object[] =
        step === 1
          ? [
              { type: 'stream-start' as const, warnings: [] },
              {
                type: 'tool-call' as const,
                toolCallId: `call_${step}`,
                toolName: tool,
                input: JSON.stringify(input),
              },
              {
                type: 'finish' as const,
                finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
                usage,
              },
            ]
          : [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't1' },
              { type: 'text-delta' as const, id: 't1', delta: text },
              { type: 'text-end' as const, id: 't1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage,
              },
            ];
      return { stream: simulateReadableStream({ chunks }) as never };
    },
  });
}

const unpaid = Buffer.from(
  [
    'Client;Facture;Dû;Jours',
    'Garage Bè;F-0412;310 000;42',
    'M. Kossi;F-0398;120 000;35',
    'Hôtel du Golfe;F-0421;105 000;31',
    'Pharmacie Tokoin;F-0430;40 000;12',
  ].join('\n'),
  'utf8',
).toString('base64');

const identity = (userId: string) =>
  ({ organizationId: 'org_kya', userId, name: userId, role: 'member' }) as Parameters<
    typeof datasetTools
  >[0];

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
  await call(t.admin, 'POST', '/organization/modules', { module: 'datasets', enabled: true });
  const created = await call(t.ama, 'POST', '/datasets', {
    name: 'Factures impayées',
    fileName: 'impayes.csv',
    contentType: 'text/csv',
    data: unpaid,
  });
  datasetId = (created.body.dataset as { datasetId: string }).datasetId;
});

afterAll(async () => {
  useModel(undefined);
  await db?.drop();
});

describe('what a tool read, as a table', () => {
  it('gives the rows themselves: filtered, sorted, with the data set’s own columns', async () => {
    const rows = datasetTools(identity('usr_ama')).find((tool) => tool.name === 'team_data_rows');
    const answer = await rows?.execute({
      datasetId,
      filters: [{ column: 'Jours', op: 'gte', value: 30 }],
      columns: ['Client', 'Dû', 'Jours'],
      sortBy: 'Dû',
    });
    expect(answer).toMatchObject({
      status: 'done',
      output: {
        rows: [
          { Client: 'Garage Bè', Dû: 310000, Jours: 42 },
          { Client: 'M. Kossi', Dû: 120000, Jours: 35 },
          { Client: 'Hôtel du Golfe', Dû: 105000, Jours: 31 },
        ],
        truncated: false,
        table: {
          title: 'Factures impayées',
          columns: [
            { key: 'Client', label: 'Client', kind: 'text' },
            { key: 'Dû', label: 'Dû', kind: 'number' },
            { key: 'Jours', label: 'Jours', kind: 'number' },
          ],
          source: { label: 'Factures impayées', href: `/donnees/${datasetId}` },
        },
      },
    });
    // A column the data set does not have is said, not guessed.
    expect(await rows?.execute({ datasetId, sortBy: 'Montant' })).toMatchObject({
      output: { error: 'Unknown columns: Montant' },
    });
    // What she may not read is not found, as for any reader.
    const theirs = datasetTools(identity('usr_kofi')).find(
      (tool) => tool.name === 'team_data_rows',
    );
    expect(await theirs?.execute({ datasetId })).toMatchObject({ output: { error: 'not_found' } });
  });

  it('says a summed-up figure as a measure, for the screens to word', async () => {
    const query = datasetTools(identity('usr_ama')).find((tool) => tool.name === 'team_data_query');
    const answer = (await query?.execute({
      datasetId,
      groupBy: ['Client'],
      measures: [{ fn: 'sum', column: 'Dû' }],
      limit: 2,
    })) as { output: unknown };
    expect(tableOf(answer.output)).toMatchObject({
      columns: [
        { key: 'Client', label: 'Client', kind: 'text' },
        { key: 'sum(Dû)', label: '', kind: 'number', measure: { fn: 'sum', column: 'Dû' } },
      ],
      rows: [
        { Client: 'Garage Bè', 'sum(Dû)': 310000 },
        { Client: 'M. Kossi', 'sum(Dû)': 120000 },
      ],
    });
  });

  it('keeps only the columns a table names, and is nothing without rows or without a shape', () => {
    const table = { title: 'Tickets', columns: [{ key: 'id' }], source: { label: 'Support' } };
    expect(tableOf({ table, rows: [{ id: 'T-1', secret: 'x', nested: { a: 1 } }] })).toEqual({
      title: 'Tickets',
      columns: [{ key: 'id', label: '', kind: 'text' }],
      source: { label: 'Support', href: null },
      rows: [{ id: 'T-1' }],
      truncated: false,
    });
    expect(tableOf({ table, rows: [] })).toBeNull();
    expect(tableOf({ rows: [{ id: 'T-1' }] })).toBeNull();
    expect(tableOf({ table: { title: 'x', columns: [] }, rows: [{ id: 1 }] })).toBeNull();
    // An address outside the space is not a source.
    expect(
      tableOf({
        table: { ...table, source: { label: 'x', href: 'https://elsewhere.example' } },
        rows: [{ id: 1 }],
      }),
    ).toBeNull();
    expect(
      tableOf({ table, rows: Array.from({ length: 250 }, (_, id) => ({ id })) }),
    ).toMatchObject({ truncated: true, rows: { length: 200 } });
  });
});

describe('an answer that is a table', () => {
  it('streams the table its tool read, and keeps it with the answer', async () => {
    useModel(
      streamingModel(
        'team_data_rows',
        {
          datasetId,
          filters: [{ column: 'Jours', op: 'gte', value: 30 }],
          sortBy: 'Dû',
        },
        'Trois factures dépassent 30 jours : le tableau les montre.',
      ),
    );
    const events = await chat(t.ama, { message: 'Qui me doit de l’argent depuis 30 jours ?' });
    const table = events.find((event) => event.type === 'table');
    expect(table).toMatchObject({
      tool: 'team_data_rows',
      title: 'Factures impayées',
      rows: [
        { Client: 'Garage Bè', Facture: 'F-0412', Dû: 310000, Jours: 42 },
        { Client: 'M. Kossi', Facture: 'F-0398', Dû: 120000, Jours: 35 },
        { Client: 'Hôtel du Golfe', Facture: 'F-0421', Dû: 105000, Jours: 31 },
      ],
      source: { href: `/donnees/${datasetId}` },
    });
    expect(events.at(-1)).toMatchObject({ type: 'done' });

    const conversationId = String(events[0]?.conversationId);
    const kept = (await call(t.ama, 'GET', `/assistant/conversations/${conversationId}`))
      .body as unknown as {
      messages: { role: string; tables: { tool: string; rows: unknown[] }[] }[];
    };
    expect(kept.messages.map((message) => message.tables.length)).toEqual([0, 1]);
    expect(kept.messages[1]?.tables[0]).toMatchObject({ tool: 'team_data_rows' });
    expect(kept.messages[1]?.tables[0]?.rows).toHaveLength(3);
  });

  it('shows no table for a tool that read nothing she may read', async () => {
    useModel(
      streamingModel('team_data_rows', { datasetId }, 'Je ne trouve pas ce jeu de données.'),
    );
    await call(t.admin, 'POST', '/organization/modules', { module: 'datasets', enabled: true });
    const events = await chat(t.kofi, { message: 'Qui doit de l’argent ?' });
    expect(events.some((event) => event.type === 'table')).toBe(false);
  });
});
