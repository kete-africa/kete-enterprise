import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { nextRun, runDueSchedules, useModel } from '../src/features/assistant/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 029: a person's scheduled tasks — her morning briefing, or a question her assistant answers
// at a set time with her rights — land in her « To do », and in her mailbox when she asks.

let db: TestSchema;
const api = createApi();
const t = { kofi: '', esi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `schedule-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const answering = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });

beforeAll(async () => {
  db = await startApi();
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
});

afterAll(async () => {
  useModel(undefined);
  await db?.drop();
});

/** Makes a schedule due now, as if its time had come. */
const due = (scheduleId: string) =>
  db.owner.query(
    `update ${db.schema}.assistant_schedules set next_run_at = now() - interval '1 minute'
      where schedule_id = $1`,
    [scheduleId],
  );

describe('when the next run falls', () => {
  it('reads her time zone, skips the weekend, waits for the right day', () => {
    const sunday = new Date('2026-10-04T07:00:00Z');
    const at = (when: Parameters<typeof nextRun>[0]) => nextRun(when, sunday).toISOString();
    expect(at({ cadence: 'daily', weekday: null, time: '07:30', timeZone: 'Africa/Lome' })).toBe(
      '2026-10-04T07:30:00.000Z',
    );
    expect(at({ cadence: 'weekdays', weekday: null, time: '07:30', timeZone: 'Africa/Lome' })).toBe(
      '2026-10-05T07:30:00.000Z',
    );
    expect(at({ cadence: 'weekly', weekday: 1, time: '08:00', timeZone: 'Europe/Paris' })).toBe(
      '2026-10-05T06:00:00.000Z',
    );
  });
});

describe('a person’s scheduled tasks', () => {
  let question = '';

  it('keeps a question to answer every Monday at 8, hers only', async () => {
    const created = await call(t.kofi, 'POST', '/assistant/schedules', {
      kind: 'prompt',
      title: 'Actions en retard',
      prompt: 'Quelles actions de mon équipe sont en retard ?',
      cadence: 'weekly',
      weekday: 1,
      time: '08:00',
      byEmail: true,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      schedule: { title: 'Actions en retard', cadence: 'weekly', weekday: 1, active: true },
    });
    question = (created.body.schedule as { scheduleId: string }).scheduleId;
    const nextAt = new Date((created.body.schedule as { nextRunAt: string }).nextRunAt);
    expect(nextAt.getUTCDay()).toBe(1);
    expect(nextAt.getUTCHours()).toBe(8);
    // Weekly needs its day; a question needs its words.
    expect(
      (
        await call(t.kofi, 'POST', '/assistant/schedules', {
          kind: 'prompt',
          title: 'Sans jour',
          prompt: 'x',
          cadence: 'weekly',
          time: '08:00',
        })
      ).status,
    ).toBe(422);
    expect((await call(t.esi, 'GET', '/assistant/schedules')).body).toEqual({ schedules: [] });
    expect((await call(t.esi, 'POST', `/assistant/schedules/${question}/run`, {})).status).toBe(
      404,
    );
  });

  it('runs when due: the answer waits in her To do and in her mailbox', async () => {
    useModel(answering('Deux actions sont en retard : relancer le client, livrer la pièce.'));
    await due(question);
    expect(await runDueSchedules()).toBe(1);
    // Taken once: the next round finds nothing due.
    expect(await runDueSchedules()).toBe(0);

    const tasks = (await call(t.kofi, 'GET', '/workspace/tasks')).body.tasks as {
      source: string;
      title: string;
      href: string;
    }[];
    expect(tasks).toContainEqual(
      expect.objectContaining({ source: 'assistant', title: 'Actions en retard' }),
    );
    const href = tasks.find((x) => x.source === 'assistant')?.href ?? '';
    expect(href).toMatch(/^https:\/\/enterprise\.kete\.test\/assistant\?c=cnv_/);
    const conversationId = new URL(href).searchParams.get('c');
    const conversation = await call(t.kofi, 'GET', `/assistant/conversations/${conversationId}`);
    expect(JSON.stringify(conversation.body)).toContain('Deux actions sont en retard');

    const { rows } = await db.owner.query<{ subject: string; recipient: string }>(
      `select subject, recipient from ${db.schema}.mail_messages where purpose = 'assistant.schedule'`,
    );
    expect(rows).toEqual([
      { subject: 'Votre tâche planifiée : Actions en retard', recipient: 'usr_kofi@example.test' },
    ]);
    const listed = (await call(t.kofi, 'GET', '/assistant/schedules')).body.schedules as {
      lastStatus: string;
      nextRunAt: string;
    }[];
    expect(listed[0]?.lastStatus).toBe('done');
    expect(new Date(listed[0]?.nextRunAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes her morning briefing on schedule, and runs one at once when she asks', async () => {
    useModel(answering('Bonjour Kofi. Rien ne presse ce matin.'));
    const created = await call(t.kofi, 'POST', '/assistant/schedules', {
      kind: 'briefing',
      title: 'Mon briefing',
      cadence: 'weekdays',
      time: '07:30',
    });
    const briefing = (created.body.schedule as { scheduleId: string }).scheduleId;
    const ran = await call(t.kofi, 'POST', `/assistant/schedules/${briefing}/run`, {});
    expect(ran).toMatchObject({ status: 201, body: { status: 'done' } });
    expect((await call(t.kofi, 'GET', '/assistant/briefing')).body.text).toBe(
      'Bonjour Kofi. Rien ne presse ce matin.',
    );
  });

  it('pauses, resumes and removes a task of hers', async () => {
    const paused = await call(t.kofi, 'POST', `/assistant/schedules/${question}/active`, {
      active: false,
    });
    expect(paused.body).toMatchObject({ schedule: { active: false } });
    await due(question);
    expect(await runDueSchedules()).toBe(0);
    await call(t.kofi, 'POST', `/assistant/schedules/${question}/active`, { active: true });
    expect(await runDueSchedules()).toBe(0);
    expect(
      (await call(t.kofi, 'POST', `/assistant/schedules/${question}/remove`, {})).body,
    ).toEqual({ removed: true });
    const left = (await call(t.kofi, 'GET', '/assistant/schedules')).body.schedules as unknown[];
    expect(left).toHaveLength(1);
  });
});
