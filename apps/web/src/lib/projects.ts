import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Projects (spec 074, doctrine D-047): one object — its thread and files (its dossier), its team,
// its client, its budget by post.

export interface Project {
  projectId: string;
  name: string;
  dossierId: string;
  party: { partyId: string; name: string } | null;
  lead: { userId: string; name: string };
  status: 'open' | 'delivered' | 'closed';
  phase: string | null;
  startsOn: string | null;
  endsOn: string | null;
  /** In the currency's smallest unit. */
  sold: number | null;
  currency: string;
  bornFrom: { source: string; ref: string } | null;
  team: { userId: string; name: string; lead: boolean }[];
  posts: { postId: string; name: string; budget: number }[];
  budget: number;
  expectedMargin: number | null;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const projectId = (value: unknown) => {
  if (typeof value !== 'string' || !/^prj_[0-9a-f-]{8,64}$/.test(value))
    throw new Error('Unknown.');
  return value;
};
/** An amount as she types it — « 1 450 000 » — in whole units of a currency without decimals. */
const amount = (value: unknown): number | null => {
  const digits = text(value, 20).replace(/[^0-9]/g, '');
  return digits === '' ? null : Number(digits);
};

export const fetchProjects = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ projects: Project[]; manages: boolean }>(getRequest(), '/v1/projects'),
);

export const fetchProject = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    projectId: projectId((input as { projectId?: unknown })?.projectId),
  }))
  .handler(({ data }) =>
    callApi<{ project: Project }>(getRequest(), `/v1/projects/${data.projectId}`)
      .then((answer) => answer.project)
      .catch(() => null),
  );

export const createProject = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const partyId = text(v.partyId, 80);
    const sold = amount(v.sold);
    return {
      name: text(v.name, 160),
      ...(/^pty_[0-9a-f-]{8,64}$/.test(partyId) ? { partyId } : {}),
      ...(sold === null ? {} : { sold }),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ project: Project }>(
      getRequest(),
      '/v1/projects',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, projectId: answer.data.project.projectId, error: null }
      : { ok: false as const, projectId: null, error: answer.error };
  });

export type ProjectChange =
  | { kind: 'post'; name: string; budget: string }
  | { kind: 'team'; colleague: string; on: boolean }
  | { kind: 'facts'; phase: string; sold: string }
  | { kind: 'status'; status: Project['status'] };

export const changeProject = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { projectId?: unknown; change?: Record<string, unknown> };
    const change = v.change ?? {};
    const id = projectId(v.projectId);
    switch (change.kind) {
      case 'post':
        return {
          projectId: id,
          path: '/posts',
          body: { name: text(change.name, 120), budget: amount(change.budget) ?? 0 },
        };
      case 'team':
        return {
          projectId: id,
          path: '/team',
          body: { colleague: text(change.colleague, 128), on: change.on !== false },
        };
      case 'facts': {
        const sold = amount(change.sold);
        return {
          projectId: id,
          path: '',
          body: { phase: text(change.phase, 80) || null, ...(sold === null ? {} : { sold }) },
        };
      }
      case 'status':
        if (
          change.status !== 'open' &&
          change.status !== 'delivered' &&
          change.status !== 'closed'
        ) {
          throw new Error('Unknown.');
        }
        return { projectId: id, path: '', body: { status: change.status } };
      default:
        throw new Error('Unknown.');
    }
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/projects/${data.projectId}${data.path}`,
      data.body,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });
