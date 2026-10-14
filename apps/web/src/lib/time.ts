import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi } from '@/platform/api';

// Planifier (spec 079, doctrine D-050): the days of a person, her team or the organization, as the
// API lets her see them — another person's absence and a « busy » fact without their words — and
// what clashes, computed by @kete/time.

export type Scope = 'me' | 'team' | 'organization';

/** A fact as she may see it (dated-fact.v1): `masked` when its words are not hers to read. */
export interface SeenFact {
  source: string;
  key: string;
  kind: 'meeting' | 'deadline' | 'absence' | 'task' | 'milestone' | 'agent_run';
  label: string;
  day?: string;
  until?: string;
  starts_at?: string;
  ends_at?: string;
  person_ids?: string[];
  project_id?: string;
  party_id?: string;
  visibility?: 'shared' | 'busy' | 'private';
  href?: string;
  masked?: boolean;
}

export interface Clash {
  kind: 'absent' | 'overlap';
  person: string;
  start: number;
  absence?: string;
  fact?: string;
  facts?: [string, string];
}

export interface Days {
  from: string;
  days: number;
  scope: Scope;
  canSeeOrganization: boolean;
  facts: SeenFact[];
  conflicts: Clash[];
  people: { userId: string; name: string }[];
}

const DAY = 86_400_000;

/** The Monday of the week a day falls in, `2026-10-12`. */
export function mondayOf(day: string): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(at).getUTCDay() + 6) % 7;
  return new Date(at - weekday * DAY).toISOString().slice(0, 10);
}

export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isScope = (value: unknown): value is Scope =>
  value === 'me' || value === 'team' || value === 'organization';

export const fetchDays = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { from?: unknown; scope?: unknown };
    return {
      from: mondayOf(isDay(v.from) ? v.from : new Date().toISOString().slice(0, 10)),
      scope: isScope(v.scope) ? v.scope : ('me' as Scope),
    };
  })
  .handler(({ data }) =>
    callApi<Days>(getRequest(), `/v1/time/days?from=${data.from}&days=7&scope=${data.scope}`),
  );
