import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// The company's library (spec 028), as the API serves it.

export interface LibrarySource {
  sourceId: string;
  name: string;
  kind: string;
  enabled: boolean;
  audience: string[];
  documents: number;
  createdAt: string;
}

export interface LibraryDocument {
  documentId: string;
  sourceId: string;
  title: string;
  uri: string | null;
  pages: number | null;
  chunks: number;
  updatedAt: string;
}

export interface LibraryHit {
  score: number;
  text: string;
  page: number | null;
  documentId: string;
  title: string;
  uri: string | null;
  sourceId: string;
  sourceName: string;
  label: string;
  href: string;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown, prefix: string) => {
  const id = text(value, 80);
  if (!new RegExp(`^${prefix}_[0-9A-Za-z_-]{4,70}$`).test(id)) throw new Error('Which one?');
  return id;
};
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

export const fetchSources = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ manage: boolean; sources: LibrarySource[] }>(getRequest(), '/v1/knowledge/sources'),
);

export const searchLibrary = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ q: text((input as { q?: unknown } | null)?.q, 500) }))
  .handler(async ({ data }) => {
    if (data.q.trim().length < 2) return { hits: [] as LibraryHit[], error: null };
    try {
      return await callApi<{ hits: LibraryHit[] }>(
        getRequest(),
        `/v1/knowledge/search?q=${encodeURIComponent(data.q)}`,
      ).then((r) => ({ hits: r.hits, error: null }));
    } catch {
      return { hits: [] as LibraryHit[], error: 'knowledge_unavailable' };
    }
  });

const audienceOf = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter(
          (k): k is string =>
            typeof k === 'string' && /^(everyone|role:admin|unit:[\w-]{1,80})$/.test(k),
        )
        .slice(0, 100)
    : ['everyone'];

export const createSource = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { name: text(v.name, 200), audience: audienceOf(v.audience) };
  })
  .handler(async ({ data }) =>
    answerOf(await sendGesture(getRequest(), '/v1/knowledge/sources', data, crypto.randomUUID())),
  );

export const updateSource = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      sourceId: idOf(v.sourceId, 'ksrc'),
      change: {
        ...(typeof v.enabled === 'boolean' ? { enabled: v.enabled } : {}),
        ...(Array.isArray(v.audience) ? { audience: audienceOf(v.audience) } : {}),
      },
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/knowledge/sources/${data.sourceId}`,
        data.change,
        crypto.randomUUID(),
      ),
    ),
  );

export const removeSource = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    sourceId: idOf((input as { sourceId?: unknown } | null)?.sourceId, 'ksrc'),
  }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/knowledge/sources/${data.sourceId}/remove`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );

export const fetchDocuments = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    sourceId: idOf((input as { sourceId?: unknown } | null)?.sourceId, 'ksrc'),
  }))
  .handler(({ data }) =>
    callApi<{ documents: LibraryDocument[] }>(
      getRequest(),
      `/v1/knowledge/sources/${data.sourceId}/documents`,
    ),
  );

/** A document read and indexed in its source. */
export const uploadDocument = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      sourceId: idOf(v.sourceId, 'ksrc'),
      name: text(v.name, 300),
      contentType: text(v.contentType, 120),
      data: text(v.data, 28_000_000),
    };
  })
  .handler(async ({ data }) =>
    answerOf<{ documentId: string; chunks: number; unchanged: boolean }>(
      await sendGesture(
        getRequest(),
        `/v1/knowledge/sources/${data.sourceId}/documents`,
        { name: data.name, contentType: data.contentType, data: data.data },
        crypto.randomUUID(),
      ),
    ),
  );

export const removeDocument = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    documentId: idOf((input as { documentId?: unknown } | null)?.documentId, 'kdoc'),
  }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/knowledge/documents/${data.documentId}/remove`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );
