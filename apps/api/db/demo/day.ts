import type { Hono } from 'hono';
import { MockLanguageModelV4 } from 'ai/test';
import { runTask, useTaskModel } from '../../src/features/agents/index.js';
import { useNoteModel } from '../../src/features/notes/index.js';
import { useCardReader } from '../../src/features/registry/index.js';
import { UNPAID_INVOICES } from './answers.js';

// A day for the demo (step C2): what waits for the head of after-sales when she opens the center
// in the morning — two decisions, a reminder, what her agent did overnight and what it is doing
// now. Played through the API as the demo's own people, so that every line is a real gesture with
// its journal; the words a model would write are scripted here, and no model is called.

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const says = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });

export interface DayReport {
  decisions: number;
  reminders: number;
  agentTasksDone: number;
  agentTasksWaiting: number;
  /** The team's data the demo's assistant reads (step C3), when it could be dropped. */
  datasetId: string | null;
  /** What could not be played, in words: the day is still usable without it. */
  skipped: string[];
}

export async function seedDay(options: {
  api: Hono;
  organizationId: string;
  /** The organization's administrator. */
  admin: string;
  /** The head of after-sales, whose morning it is: her token and her person. */
  manager: { token: string; personId: string };
  /** A colleague who asks her for decisions. */
  colleague: { token: string };
}): Promise<DayReport> {
  const { api, organizationId, admin, manager, colleague } = options;
  const report: DayReport = {
    decisions: 0,
    reminders: 0,
    agentTasksDone: 0,
    agentTasksWaiting: 0,
    datasetId: null,
    skipped: [],
  };
  let key = 0;
  const call = async (token: string, method: 'GET' | 'POST', path: string, body?: object) => {
    const response = await api.request(`/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `demo-day-${Date.now()}-${++key}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: answer };
  };
  const skipped = (what: string, status: number) => report.skipped.push(`${what} (${status})`);

  // No app is reached during a demo: its identity card is read from here.
  useCardReader(async () => ({
    product: 'prd_demo',
    name: 'Démonstration',
    version: '1.0.0',
    governance: {
      owner: { name: 'Service SAV & Maintenance' },
      dataCategories: ['personal'],
      ai: { used: false },
      criticality: 'medium',
    },
  }));

  // Two decisions wait for her: colleagues ask that their tools be opened to the organization.
  const circuit = await call(admin, 'POST', '/decisions/circuits', {
    subject: 'registry.promotion',
    name: 'Ouverture d’un outil à l’organisation',
    steps: [{ rule: 'person', personId: manager.personId }],
  });
  if (circuit.status !== 201 && circuit.status !== 409) skipped('circuit', circuit.status);
  for (const tool of [
    { name: 'Suivi des batteries', address: 'https://batteries.example.test' },
    { name: 'Relances des impayés', address: 'https://relances.example.test' },
  ]) {
    const resource = await call(colleague.token, 'POST', '/registry/resources', {
      kind: 'app',
      ...tool,
    });
    const resourceId = String(resource.body.resourceId ?? '');
    if (!resourceId) {
      skipped(`resource « ${tool.name} »`, resource.status);
      continue;
    }
    const asked = await call(
      colleague.token,
      'POST',
      `/registry/resources/${resourceId}/promotions`,
      { target: { kind: 'organization' } },
    );
    if (asked.body.decisionRequestId) report.decisions += 1;
    else skipped(`decision « ${tool.name} »`, asked.status);
  }

  // Her team's unpaid invoices, dropped as a sheet: what the assistant's answer is a table of.
  await call(admin, 'POST', '/organization/modules', { module: 'datasets', enabled: true });
  const dataset = await call(manager.token, 'POST', '/datasets', {
    name: 'Factures impayées',
    fileName: 'factures-impayees.csv',
    contentType: 'text/csv',
    data: Buffer.from(UNPAID_INVOICES, 'utf8').toString('base64'),
  });
  report.datasetId =
    (dataset.body.dataset as { datasetId?: string } | undefined)?.datasetId ?? null;
  if (!report.datasetId) skipped('dataset', dataset.status);

  // A reminder from her notebook, dated tomorrow morning.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  useNoteModel(
    says(
      JSON.stringify({
        summary: 'Appeler le fournisseur des onduleurs.',
        reminder: { title: 'Appeler le fournisseur des onduleurs', at: `${tomorrow}T09:00` },
      }),
    ),
  );
  const note = await call(manager.token, 'POST', '/notes', {
    text: 'Appeler le fournisseur des onduleurs demain à 9 h',
  });
  if (note.status < 300) report.reminders += 1;
  else skipped('reminder', note.status);
  useNoteModel(undefined);

  // Her agent: one task done overnight, one still waiting — « Pendant ce temps ».
  const agent = await call(manager.token, 'POST', '/agents', {
    name: 'Agent SAV',
    kind: 'personal',
    mission: 'Suivre les tickets et les impayés du service SAV & Maintenance.',
    watches: ['decisions'],
  });
  const agentId = String(agent.body.agentId ?? '');
  if (!agentId) {
    skipped('agent', agent.status);
  } else {
    const give = async (instruction: string) => {
      const given = await call(manager.token, 'POST', `/agents/${agentId}/tasks`, { instruction });
      return String((given.body.task as { taskId?: string } | undefined)?.taskId ?? '');
    };
    const done = await give('Prépare la relance du client Garage Bè pour sa facture en retard.');
    if (done) {
      useTaskModel(
        says(
          'Relance préparée : « Bonjour, votre facture reste due depuis 42 jours. Pouvez-vous nous indiquer une date de règlement ? »',
        ),
      );
      const outcome = await runTask(organizationId, done).catch(() => 'failed');
      if (outcome === 'done') report.agentTasksDone += 1;
      else skipped('agent task', 0);
      useTaskModel(undefined);
    }
    const waiting = await give('Résume les tickets critiques ouverts cette semaine.');
    if (waiting) report.agentTasksWaiting += 1;
  }
  return report;
}
