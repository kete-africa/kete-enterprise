import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';

// The structure as the API serves it (spec 002): the screens hold no data of their own.

export type AssignmentKind = 'primary' | 'functional' | 'project' | 'interim' | 'delegation';
export const assignmentKinds: AssignmentKind[] = [
  'primary',
  'functional',
  'project',
  'interim',
  'delegation',
];

export interface Chart {
  asOf: string;
  unitTypes: { unitTypeId: string; key: string; name: string; legalEntity: boolean }[];
  units: {
    unitId: string;
    unitTypeId: string;
    parentId: string | null;
    name: string;
    code: string | null;
    country: string | null;
    startsOn: string;
    endsOn: string | null;
  }[];
  positions: {
    positionId: string;
    unitId: string;
    title: string;
    reportsTo: string | null;
    startsOn: string;
    endsOn: string | null;
  }[];
  people: { personId: string; name: string; email: string | null; phone: string | null }[];
  assignments: {
    assignmentId: string;
    personId: string;
    positionId: string;
    kind: AssignmentKind;
    startsOn: string;
    endsOn: string | null;
  }[];
}

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The organization as of a date. */
export const fetchChart = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const asOf = (input as { asOf?: unknown } | undefined)?.asOf;
    return { asOf: isDay(asOf) ? asOf : undefined };
  })
  .handler(({ data }) =>
    callApi<Chart>(getRequest(), `/v1/structure${data.asOf ? `?asOf=${data.asOf}` : ''}`),
  );

/** The gestures the screen may send: each is a named command of the API. */
const gestures = ['/unit-types', '/units', '/positions', '/people', '/assignments'] as const;
type GesturePath =
  | (typeof gestures)[number]
  | `/units/${string}/${'move' | 'close'}`
  | `/assignments/${string}/end`
  | `/positions/${string}/close`;

const isGesturePath = (path: unknown): path is GesturePath =>
  typeof path === 'string' &&
  ((gestures as readonly string[]).includes(path) ||
    /^\/units\/unt_[0-9a-f-]+\/(move|close)$/.test(path) ||
    /^\/positions\/pos_[0-9a-f-]+\/close$/.test(path) ||
    /^\/assignments\/asg_[0-9a-f-]+\/end$/.test(path));

export const changeStructure = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (!isGesturePath(path)) throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  // The screen reloads the chart after a gesture: it only needs to know whether it went through.
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer: GestureAnswer<unknown> = await sendGesture(
      getRequest(),
      `/v1/structure${data.path}`,
      data.body,
      data.key,
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
