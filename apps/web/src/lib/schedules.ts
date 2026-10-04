import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Her scheduled tasks (spec 029), as the API serves them.

export type Cadence = 'daily' | 'weekdays' | 'weekly';

export interface Schedule {
  scheduleId: string;
  kind: 'briefing' | 'prompt';
  title: string;
  prompt: string | null;
  cadence: Cadence;
  weekday: number | null;
  time: string;
  timeZone: string;
  byEmail: boolean;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'done' | 'failed' | 'no_model' | null;
}

export const fetchSchedules = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ schedules: Schedule[] }>(getRequest(), '/v1/assistant/schedules'),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

const answerOf = (answer: { ok: boolean; error?: string | null }) =>
  answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error ?? null };

/** Keeps a new scheduled task of hers. */
export const createSchedule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const cadence = (['daily', 'weekdays', 'weekly'] as const).find((c) => c === v.cadence);
    return {
      kind: v.kind === 'briefing' ? ('briefing' as const) : ('prompt' as const),
      title: text(v.title, 120),
      prompt: text(v.prompt, 2000),
      cadence: cadence ?? 'daily',
      weekday: typeof v.weekday === 'number' ? v.weekday : 1,
      time: text(v.time, 5),
      timeZone: text(v.timeZone, 64),
      byEmail: v.byEmail === true,
      locale: v.locale === 'en' ? ('en' as const) : ('fr' as const),
    };
  })
  .handler(async ({ data }) => {
    const body = {
      kind: data.kind,
      title: data.title,
      ...(data.kind === 'prompt' ? { prompt: data.prompt } : {}),
      cadence: data.cadence,
      ...(data.cadence === 'weekly' ? { weekday: data.weekday } : {}),
      time: data.time,
      ...(data.timeZone ? { timeZone: data.timeZone } : {}),
      byEmail: data.byEmail,
      locale: data.locale,
    };
    return answerOf(
      await sendGesture(getRequest(), '/v1/assistant/schedules', body, crypto.randomUUID()),
    );
  });

const scheduleIdOf = (input: unknown) => {
  const id = (input as { scheduleId?: unknown } | null)?.scheduleId;
  if (typeof id !== 'string' || !/^sch_[0-9A-Za-z_-]{4,64}$/.test(id)) {
    throw new Error('Which task?');
  }
  return id;
};

/** Pauses or resumes one of hers. */
export const setScheduleActive = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    scheduleId: scheduleIdOf(input),
    active: (input as { active?: unknown }).active === true,
  }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/assistant/schedules/${data.scheduleId}/active`,
        { active: data.active },
        crypto.randomUUID(),
      ),
    ),
  );

/** Runs one of hers at once. */
export const runSchedule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ scheduleId: scheduleIdOf(input) }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/assistant/schedules/${data.scheduleId}/run`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );

export const removeSchedule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ scheduleId: scheduleIdOf(input) }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/assistant/schedules/${data.scheduleId}/remove`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );
