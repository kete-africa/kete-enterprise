import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi } from '@/platform/api';

// The Measure (spec 102; doctrine D-062, R7, R17): the organization's indicators, each read live
// with her rights, with where its figure comes from; a source that does not answer is missing.

export interface Indicator {
  indicatorId: string;
  name: string;
  formula: string;
  sourceLabel: string;
  frequency: string;
  leading: boolean;
  source: { kind: 'typed' | 'center' | 'dataset' | 'metric' } | null;
  unit: string | null;
  direction: 'higher' | 'lower' | null;
  target: number | null;
  threshold: number | null;
  alertWhen: '<' | '<=' | '>' | '>=' | null;
}

export interface Reading {
  indicatorId: string;
  value: number | null;
  status: 'done' | 'missing' | 'denied' | 'typed' | 'refused';
  colour: 'green' | 'orange' | 'red' | null;
  provenance: {
    source: string;
    filter: Record<string, string>;
    period: { from: string; to: string } | null;
    counted: number | null;
    at: string;
  };
}

const day = /^\d{4}-\d{2}-\d{2}$/;

/** Her indicators over a period, each read live. */
export const fetchIndicators = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { from?: unknown; to?: unknown; unit?: unknown };
    const params = new URLSearchParams();
    if (typeof v.from === 'string' && day.test(v.from)) params.set('from', v.from);
    if (typeof v.to === 'string' && day.test(v.to)) params.set('to', v.to);
    if (typeof v.unit === 'string' && /^unt_[0-9a-f-]{8,64}$/.test(v.unit))
      params.set('unit', v.unit);
    return { search: params.toString() };
  })
  .handler(({ data }) =>
    callApi<{ indicators: Indicator[]; readings: Reading[]; manages: boolean }>(
      getRequest(),
      `/v1/measure/indicators?${data.search}`,
    ).catch(() => ({ indicators: [] as Indicator[], readings: [] as Reading[], manages: false })),
  );
