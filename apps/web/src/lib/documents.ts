import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Documents (spec 038), as the API serves them.

export interface DocumentTemplate {
  templateId: string;
  name: string;
  description: string | null;
  fields: string[];
  size: number;
  enabled: boolean;
  createdAt: string;
}
export interface GeneratedDocument {
  documentId: string;
  name: string;
  contentType: string;
  size: number;
  templateId: string | null;
  createdAt: string;
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

export const fetchTemplates = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ manage: boolean; pdf: boolean; templates: DocumentTemplate[] }>(
    getRequest(),
    '/v1/documents/templates',
  ),
);

export const fetchMyDocuments = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ documents: GeneratedDocument[] }>(getRequest(), '/v1/documents'),
);

export const uploadTemplate = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      name: text(v.name, 160),
      description: text(v.description, 1000),
      data: text(v.data, 14_000_000),
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        '/v1/documents/templates',
        {
          name: data.name,
          data: data.data,
          ...(data.description ? { description: data.description } : {}),
        },
        crypto.randomUUID(),
      ),
    ),
  );

export const changeTemplate = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      templateId: idOf(v.templateId, 'dtpl'),
      remove: v.remove === true,
      enabled: v.enabled === true,
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        data.remove
          ? `/v1/documents/templates/${data.templateId}/remove`
          : `/v1/documents/templates/${data.templateId}`,
        data.remove ? {} : { enabled: data.enabled },
        crypto.randomUUID(),
      ),
    ),
  );

export const fillTemplate = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const values = Object.fromEntries(
      Object.entries((v.values ?? {}) as Record<string, unknown>)
        .slice(0, 100)
        .map(([k, value]) => [k.slice(0, 100), text(value, 5000)]),
    );
    return {
      templateId: idOf(v.templateId, 'dtpl'),
      values,
      format: v.format === 'pdf' ? 'pdf' : 'docx',
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ document: GeneratedDocument }>(
        getRequest(),
        `/v1/documents/templates/${data.templateId}/fill`,
        { values: data.values, format: data.format },
        crypto.randomUUID(),
      ),
    ),
  );

export const canvasPdf = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { title: text(v.title, 160) || 'Document', markdown: text(v.markdown, 200_000) };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ document: GeneratedDocument }>(
        getRequest(),
        '/v1/documents/pdf',
        data,
        crypto.randomUUID(),
      ),
    ),
  );

export const removeMyDocument = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    documentId: idOf((input as { documentId?: unknown } | null)?.documentId, 'gdoc'),
  }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(
        getRequest(),
        `/v1/documents/${data.documentId}/remove`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );
