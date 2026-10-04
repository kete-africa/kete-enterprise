import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// A team's data (spec 031), as the API serves it.

export interface TeamDataset {
  datasetId: string;
  name: string;
  description: string | null;
  columns: { name: string; type: 'number' | 'date' | 'text' }[];
  timeColumn: string | null;
  measures: string[];
  dimensions: string[];
  audience: string[];
  ownerId: string;
  sourceName: string | null;
  rowCount: number;
  updatedAt: string;
}
type Cell = number | string | null;

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown) => {
  const id = text(value, 80);
  if (!/^tds_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which data set?');
  return id;
};
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

export const fetchDatasets = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ manage: boolean; datasets: TeamDataset[] }>(getRequest(), '/v1/datasets'),
);

export const fetchDataset = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    datasetId: idOf((input as { datasetId?: unknown } | null)?.datasetId),
  }))
  .handler(({ data }) =>
    callApi<{ dataset: TeamDataset; manage: boolean; preview: Record<string, Cell>[] }>(
      getRequest(),
      `/v1/datasets/${data.datasetId}`,
    ),
  );

/** A table brought, or a new version of a data set's table. */
export const uploadTable = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      datasetId: v.datasetId ? idOf(v.datasetId) : null,
      name: text(v.name, 160),
      fileName: text(v.fileName, 300),
      contentType: text(v.contentType, 120),
      data: text(v.data, 28_000_000),
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ dataset: TeamDataset }>(
        getRequest(),
        data.datasetId ? `/v1/datasets/${data.datasetId}/rows` : '/v1/datasets',
        {
          ...(data.datasetId ? {} : { name: data.name }),
          fileName: data.fileName,
          contentType: data.contentType,
          data: data.data,
        },
        crypto.randomUUID(),
      ),
    ),
  );

export const datasetGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const audience =
      v.audience === 'everyone'
        ? ['everyone']
        : typeof v.audience === 'string' && /^user:[A-Za-z0-9_.-]{1,80}$/.test(v.audience)
          ? [v.audience]
          : null;
    return { datasetId: idOf(v.datasetId), remove: v.remove === true, audience };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ removed?: boolean }>(
        getRequest(),
        data.remove ? `/v1/datasets/${data.datasetId}/remove` : `/v1/datasets/${data.datasetId}`,
        data.remove ? {} : { audience: data.audience ?? undefined },
        crypto.randomUUID(),
      ),
    ),
  );
