import type { View } from '@kete/sdk';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Reading } from '@/lib/measure';

// Views configured where they are used (spec 103; doctrine D-062, R22; ADR 0016): the view a place
// shows her — Kete's default, the organization's, her position's or her own — and what each of its
// cards shows, read with her rights.

export interface PlacedView {
  view: View;
  level: 'app' | 'organization' | 'position' | 'person';
  version: number;
  layers: { level: string; owner: string; version: number }[];
  administrator: boolean;
}

export interface ViewData {
  state: 'done' | 'empty' | 'missing' | 'denied';
  rows: Record<string, string | number | boolean | null>[];
  readings: Reading[];
  provenance: {
    source: string;
    filter: Record<string, string>;
    counted: number | null;
    at: string;
  } | null;
}

const place = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,40}(:[a-z0-9_-]{1,80})?$/.test(value)) {
    throw new Error('Unknown.');
  }
  return value;
};

// A view is JSON through and through; it travels as its text (a form's schema is any JSON).
const fetchViewText = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ place: place((input as { place?: unknown })?.place) }))
  .handler(({ data }) =>
    callApi<PlacedView>(getRequest(), `/v1/views/${encodeURIComponent(data.place)}`)
      .then((placed) => JSON.stringify(placed))
      .catch(() => null),
  );

export async function fetchView(input: { data: { place: string } }): Promise<PlacedView | null> {
  const text = await fetchViewText(input);
  return text ? (JSON.parse(text) as PlacedView) : null;
}

/** What one card shows her, with the board's filters and period. */
export const readViewData = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { view?: unknown; filter?: unknown; from?: unknown; to?: unknown };
    if (!v.view || typeof v.view !== 'object') throw new Error('Unknown.');
    return {
      view: JSON.stringify(v.view),
      filter: (v.filter ?? {}) as Record<string, string>,
      ...(typeof v.from === 'string' ? { from: v.from } : {}),
      ...(typeof v.to === 'string' ? { to: v.to } : {}),
    };
  })
  .handler(({ data }) =>
    sendGesture<ViewData>(
      getRequest(),
      '/v1/views/read',
      { ...data, view: JSON.parse(data.view) as unknown },
      crypto.randomUUID(),
    ).then((answer): ViewData =>
      answer.ok ? answer.data : { state: 'missing', rows: [], readings: [], provenance: null },
    ),
  );

/** Back to Kete's default — or the organization's: her own version set aside, kept. */
export const restoreMyView = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ place: place((input as { place?: unknown })?.place) }))
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/views/${encodeURIComponent(data.place)}/restore`,
      { level: 'person', version: null },
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });
