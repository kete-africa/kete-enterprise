import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import type { Card, Dashboard } from '@/lib/dashboards';
import { callApi, sendGesture } from '@/platform/api';

// « Aujourd'hui » (spec 046), as the API serves it.

export interface DayItem {
  kind: 'decision' | 'draft' | 'app_task' | 'form' | 'action' | 'note';
  id: string;
  title: string;
  source: string | null;
  dueAt: string | null;
  overdue: boolean;
  href: string;
  progress: { done: number; total: number } | null;
}

export interface DoneItem {
  taskId: string;
  agentName: string;
  instruction: string;
  status: 'done' | 'failed';
  answer: string | null;
  draftCount: number;
  finishedAt: string;
}

/** « Pendant ce temps » (spec 058): what her agents and her routines are doing right now. */
export interface Meanwhile {
  agents: {
    taskId: string;
    agentName: string;
    instruction: string;
    status: 'queued' | 'running';
  }[];
  routines: { runId: string; title: string; cause: string; status: 'queued' | 'running' }[];
}

/** A subject of the day, as the session names it. */
export const keyOf = (item: DayItem) => `${item.kind}:${item.id}`;

export interface Today {
  name: string;
  today: string;
  day: DayItem[];
  /** The subjects she set aside for today (spec 058). */
  later: string[];
  meanwhile: Meanwhile;
  pinned: { dashboard: Dashboard; cards: Card[] }[];
  done: DoneItem[];
}

export const fetchToday = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Today>(getRequest(), '/v1/today'),
);

const keyPattern = /^(decision|draft|app_task|form|action|note):[A-Za-z0-9_.:-]{1,160}$/;

/** « Plus tard aujourd'hui »: the subject leaves today's session. */
export const laterToday = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const key = (input as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || !keyPattern.test(key)) throw new Error('Which subject?');
    return { key };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(getRequest(), '/v1/today/later', data, crypto.randomUUID());
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

/** « Reprendre »: one subject, or all of them when none is named. */
export const resumeToday = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const key = (input as { key?: unknown } | null)?.key;
    if (key === undefined) return {};
    if (typeof key !== 'string' || !keyPattern.test(key)) throw new Error('Which subject?');
    return { key };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(getRequest(), '/v1/today/resume', data, crypto.randomUUID());
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
