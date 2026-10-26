import { newEventId } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { runQueuedRoutines } from '../src/features/routines/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 113: a routine of hers — a trigger on an app's event, a scheduled question — hands its work
// to one of her agents, which reaches the apps with the mandate she gave it (spec 108).

const ORG = 'org_routines_agents';
let db: TestSchema;
const api = createApi();
const t = { ama: '', kofi: '' };
const ids = { app: '', amaAgent: '', kofiAgent: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `routines-agents-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const card: IdentityCard = {
  product: 'prd_kete_helpdesk',
  name: 'Support',
  version: '1.0.0',
  client: 'cli_helpdesk',
  emits: [
    { type: 'ticket.critical', description: 'Un ticket critique', classification: 'internal' },
  ],
};
async function deliver() {
  await api.request('/public/apps/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer app:cli_helpdesk' },
    body: JSON.stringify({
      events: [
        {
          id: newEventId(),
          type: 'ticket.critical',
          specversion: '1',
          product: 'prd_kete_helpdesk',
          organization: ORG,
          occurred_at: new Date().toISOString(),
          data: { ticketId: 'tkt_1058', site: 'Tsévié' },
        },
      ],
    }),
  });
}
const tasksOfAgent = async (agentId: string) => {
  const { rows } = await db.owner.query<{ givenBy: string; instruction: string }>(
    `select given_by as "givenBy", instruction from ${db.schema}.agent_tasks
      where agent_id = $1 order by created_at desc`,
    [agentId],
  );
  return rows;
};

beforeAll(async () => {
  db = await startApi();
  useAppVerifier(async (token) => {
    if (!token.startsWith('app:')) throw new Error('not an app');
    return {
      clientId: token.slice(4),
      scopes: ['kete:center'],
      expiresAt: new Date(Date.now() + 60_000),
    };
  });
  useCardReader(async (address) => (address.includes('helpdesk') ? card : null));
  t.ama = await tokenFor('usr_ama', { role: 'admin', org: ORG, name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { org: ORG, name: 'Kofi' });
  await call(t.ama, 'POST', '/organization/modules', { module: 'agents', enabled: true });
  ids.app = String(
    (
      await call(t.ama, 'POST', '/registry/resources', {
        kind: 'app',
        name: 'Support',
        address: 'https://helpdesk.example.test',
      })
    ).body.resourceId,
  );
  const make = async (token: string, name: string) =>
    String(
      (
        await call(token, 'POST', '/agents', {
          name,
          kind: 'personal',
          mission: 'Suivre les tickets du Support.',
          watches: ['decisions'],
        })
      ).body.agentId,
    );
  ids.amaAgent = await make(t.ama, 'Veille Support');
  ids.kofiAgent = await make(t.kofi, 'Veille Kofi');
});

afterAll(async () => {
  await db?.drop();
});

describe('a routine handed to an agent', () => {
  it('names only an agent of hers', async () => {
    const refused = await call(t.ama, 'POST', '/routines/triggers', {
      title: 'Ticket critique',
      prompt: 'Qui est libre ?',
      resourceId: ids.app,
      eventType: 'ticket.critical',
      agentId: ids.kofiAgent,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unknown_agent');
    const schedule = await call(t.ama, 'POST', '/assistant/schedules', {
      kind: 'prompt',
      title: 'Tickets',
      prompt: 'Quels tickets restent ouverts ?',
      cadence: 'daily',
      time: '08:00',
      agentId: ids.kofiAgent,
    });
    expect(schedule.status).toBe(422);
  });

  it('gives the agent a task when an app signals, with the event’s facts', async () => {
    const made = await call(t.ama, 'POST', '/routines/triggers', {
      title: 'Ticket critique',
      prompt: 'Dis-moi quel technicien est libre.',
      resourceId: ids.app,
      eventType: 'ticket.critical',
      agentId: ids.amaAgent,
    });
    expect(made.status).toBe(201);
    await deliver();
    expect(await runQueuedRoutines()).toBe(1);
    const [task] = await tasksOfAgent(ids.amaAgent);
    expect(task?.givenBy).toBe('usr_ama');
    expect(task?.instruction).toContain('Dis-moi quel technicien est libre.');
    expect(task?.instruction).toContain('Tsévié');
    const run = ((await call(t.ama, 'GET', '/routines')).body.runs as Answer[])[0];
    expect(run).toMatchObject({
      status: 'done',
      summary: 'Confié à Veille Support',
      href: `/mes-agents?agent=${ids.amaAgent}`,
    });
  });

  it('gives it a task when a scheduled question runs', async () => {
    const made = await call(t.ama, 'POST', '/assistant/schedules', {
      kind: 'prompt',
      title: 'Tickets ouverts',
      prompt: 'Quels tickets restent ouverts ?',
      cadence: 'daily',
      time: '08:00',
      agentId: ids.amaAgent,
    });
    expect(made.status).toBe(201);
    const scheduleId = String((made.body.schedule as { scheduleId: string }).scheduleId);
    const run = await call(t.ama, 'POST', `/assistant/schedules/${scheduleId}/run`);
    expect(run.body.status).toBe('done');
    const tasks = await tasksOfAgent(ids.amaAgent);
    expect(tasks.map((x) => x.instruction)).toContain('Quels tickets restent ouverts ?');
  });

  it('fails when the agent is no longer at work, and never falls back to the assistant', async () => {
    await db.owner.query(`update ${db.schema}.agents set status = 'paused' where agent_id = $1`, [
      ids.amaAgent,
    ]);
    const before = (await tasksOfAgent(ids.amaAgent)).length;
    const triggers = (await call(t.ama, 'GET', '/routines')).body.triggers as {
      triggerId: string;
    }[];
    const tried = await call(
      t.ama,
      'POST',
      `/routines/triggers/${String(triggers[0]?.triggerId)}/try`,
    );
    expect(tried.body.status).toBe('failed');
    expect((await tasksOfAgent(ids.amaAgent)).length).toBe(before);
  });
});
