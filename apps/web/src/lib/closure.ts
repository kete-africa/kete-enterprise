import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { sendGesture } from '@/platform/api';

// The evening's closure (spec 083, doctrine D-051): her note understood as gestures on her To do,
// which she ticks, applies together and may undo together.

export interface EveningSet {
  id: string;
  status: 'proposed' | 'applied' | 'dismissed' | 'undone';
  items: {
    key: string;
    gesture: string;
    label: string;
    reason: string | null;
    level: 1 | 2 | 3 | 4;
    ticked: boolean;
  }[];
  outcomes: Record<
    string,
    'applied' | 'failed' | 'needs_confirmation' | 'not_ticked' | 'undone' | 'undo_failed'
  >;
}

type Answer =
  { ok: true; set: EveningSet | null; unclear: string[] } | { ok: false; error: string };

const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 4000) : '');
const setId = (value: unknown) => {
  if (typeof value !== 'string' || !/^pps_[0-9A-Za-z_-]{8,64}$/.test(value)) {
    throw new Error('Which set?');
  }
  return value;
};

export const closeMyDay = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ text: text((input as { text?: unknown } | null)?.text) }))
  .handler(async ({ data }): Promise<Answer> => {
    const answer = await sendGesture<{ set: EveningSet | null; unclear: string[] }>(
      getRequest(),
      '/v1/closure',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true, set: answer.data.set, unclear: answer.data.unclear }
      : { ok: false, error: answer.error };
  });

/** A gesture on her set: apply what she ticked, dismiss it, or undo it. */
export const decideMyEvening = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { id?: unknown; gesture?: unknown; ticked?: unknown };
    const gesture = v.gesture === 'dismiss' || v.gesture === 'undo' ? v.gesture : 'apply';
    const ticked = Array.isArray(v.ticked)
      ? v.ticked.filter((k): k is string => typeof k === 'string').slice(0, 30)
      : [];
    return { id: setId(v.id), gesture, ticked };
  })
  .handler(
    async ({ data }): Promise<{ ok: true; set: EveningSet } | { ok: false; error: string }> => {
      const answer = await sendGesture<{ set: EveningSet }>(
        getRequest(),
        `/v1/closure/${data.id}/${data.gesture}`,
        data.gesture === 'apply' ? { ticked: data.ticked } : {},
        crypto.randomUUID(),
      );
      return answer.ok ? { ok: true, set: answer.data.set } : { ok: false, error: answer.error };
    },
  );
