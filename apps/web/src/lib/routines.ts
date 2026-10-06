import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Schedule } from './schedules';

// Routines (spec 051), as the API serves them.

export type Family = 'time' | 'event' | 'watch';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'no_model' | 'told' | 'quiet';
export interface Trigger {
  triggerId: string;
  title: string;
  prompt: string;
  resourceId: string;
  eventType: string;
  active: boolean;
  createdAt: string;
}
export interface Watch {
  watchId: string;
  title: string;
  dashboardId: string;
  cardId: string;
  direction: 'above' | 'below';
  line: number;
  active: boolean;
  crossed: boolean;
  lastValue: number | null;
  lastCheckedAt: string | null;
}
export interface Run {
  runId: string;
  family: Family;
  routineId: string;
  title: string;
  cause: string;
  status: RunStatus;
  summary: string | null;
  href: string | null;
  tried: boolean;
  createdAt: string;
  finishedAt: string | null;
}
export interface HeardApp {
  resourceId: string;
  name: string;
  emits: { type: string; description: string }[];
}
export interface Figures {
  dashboardId: string;
  name: string;
  cards: { id: string; title: string }[];
}
export interface Routines {
  schedules: Schedule[];
  triggers: Trigger[];
  watches: Watch[];
  runs: Run[];
  apps: HeardApp[];
  figures: Figures[];
}
export type Proposal =
  | {
      family: 'time';
      title: string;
      prompt: string;
      cadence: 'daily' | 'weekdays' | 'weekly';
      weekday: number | null;
      time: string;
      plan: string[];
    }
  | {
      family: 'event';
      title: string;
      prompt: string;
      resourceId: string;
      app: string;
      eventType: string;
      event: string;
      plan: string[];
    }
  | {
      family: 'watch';
      title: string;
      dashboardId: string;
      cardId: string;
      figure: string;
      direction: 'above' | 'below';
      line: number;
      plan: string[];
    };

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

export const fetchRoutines = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Routines>(getRequest(), '/v1/routines'),
);

/** Her sentence understood, with its plan: nothing is kept yet. */
export const understandRoutine = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    sentence: text((input as { sentence?: unknown } | null)?.sentence, 1000),
  }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ proposal: Proposal }>(
        getRequest(),
        '/v1/routines/understand',
        data,
        crypto.randomUUID(),
      ),
    ),
  );

export const createTrigger = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      title: text(v.title, 120),
      prompt: text(v.prompt, 2000),
      resourceId: text(v.resourceId, 80),
      eventType: text(v.eventType, 120),
      locale: v.locale === 'en' ? ('en' as const) : ('fr' as const),
    };
  })
  .handler(async ({ data }) =>
    answerOf(await sendGesture(getRequest(), '/v1/routines/triggers', data, crypto.randomUUID())),
  );

export const createWatch = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const line = typeof v.line === 'number' && Number.isFinite(v.line) ? v.line : 0;
    return {
      title: text(v.title, 120),
      dashboardId: text(v.dashboardId, 80),
      cardId: text(v.cardId, 30),
      direction: v.direction === 'below' ? ('below' as const) : ('above' as const),
      line,
      locale: v.locale === 'en' ? ('en' as const) : ('fr' as const),
    };
  })
  .handler(async ({ data }) =>
    answerOf(await sendGesture(getRequest(), '/v1/routines/watches', data, crypto.randomUUID())),
  );

/** On a trigger or a watch of hers: pause or resume it, try it, remove it. */
export const routineGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const kind = v.kind === 'watch' ? ('watches' as const) : ('triggers' as const);
    const id = text(v.id, 80);
    if (!/^(rtr|rwt)_[0-9A-Za-z_-]{4,64}$/.test(id)) throw new Error('Which routine?');
    const action =
      v.action === 'try'
        ? ('try' as const)
        : v.action === 'remove'
          ? ('remove' as const)
          : ('active' as const);
    return { kind, id, action, active: v.active === true };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ status?: RunStatus }>(
        getRequest(),
        `/v1/routines/${data.kind}/${data.id}/${data.action}`,
        data.action === 'active' ? { active: data.active } : {},
        crypto.randomUUID(),
      ),
    ),
  );
