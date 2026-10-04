import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, callPublic, sendGesture } from '@/platform/api';

// Forms (spec 032), as the API serves them. (`forms.tsx` holds the screens' form helpers.)

export type FieldType = 'text' | 'long_text' | 'number' | 'date' | 'choice' | 'yes_no';
export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}
export interface Collection {
  collectionId: string;
  name: string;
  description: string | null;
  fields: FormField[];
  answeredBy: 'link' | 'everyone';
  measureField: string | null;
  open: boolean;
  ownerId: string;
  createdAt: string;
  subject: string;
}
export type AnswerValue = string | number | boolean | null;
export interface Submission {
  submissionId: string;
  values: Record<string, AnswerValue>;
  submittedBy: string | null;
  submitterName: string | null;
  status: 'received' | 'pending' | 'approved' | 'refused';
  createdAt: string;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown) => {
  const id = text(value, 80);
  if (!/^frm_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which form?');
  return id;
};
const tokenOf = (value: unknown) => {
  const token = text(value, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Unknown link.');
  return token;
};
/** Answers as the API takes them: texts, numbers, yes or no. */
const valuesOf = (value: unknown): Record<string, AnswerValue> =>
  Object.fromEntries(
    Object.entries((value ?? {}) as Record<string, unknown>)
      .slice(0, 40)
      .map(([k, v]) => [
        k.slice(0, 40),
        typeof v === 'number' || typeof v === 'boolean'
          ? v
          : typeof v === 'string'
            ? v.slice(0, 5000)
            : null,
      ]),
  );
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

export const fetchCollections = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ mine: (Collection & { submissions: number })[]; toAnswer: Collection[] }>(
    getRequest(),
    '/v1/forms',
  ),
);

export const fetchCollection = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    collectionId: idOf((input as { collectionId?: unknown } | null)?.collectionId),
  }))
  .handler(({ data }) =>
    callApi<{ collection: Collection; manage: boolean; submissions: Submission[] }>(
      getRequest(),
      `/v1/forms/${data.collectionId}`,
    ),
  );

export const createCollection = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const fields = (Array.isArray(v.fields) ? v.fields : []).slice(0, 40).map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const options = Array.isArray(f.options)
        ? f.options.filter((o): o is string => typeof o === 'string').slice(0, 30)
        : [];
      return {
        key: text(f.key, 40),
        label: text(f.label, 300),
        type: text(f.type, 20) as FieldType,
        required: f.required === true,
        ...(options.length ? { options } : {}),
      };
    });
    return {
      name: text(v.name, 160),
      description: text(v.description, 2000),
      answeredBy: v.answeredBy === 'link' ? ('link' as const) : ('everyone' as const),
      measureField: text(v.measureField, 40),
      fields,
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ collection: Collection }>(
        getRequest(),
        '/v1/forms',
        {
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          answeredBy: data.answeredBy,
          ...(data.measureField ? { measureField: data.measureField } : {}),
          fields: data.fields,
        },
        crypto.randomUUID(),
      ),
    ),
  );

/** A gesture of who runs a form: open or close it, create its link. */
export const collectionGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { collectionId: idOf(v.collectionId), link: v.link === true, open: v.open === true };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ url?: string; open?: boolean }>(
        getRequest(),
        data.link ? `/v1/forms/${data.collectionId}/link` : `/v1/forms/${data.collectionId}`,
        data.link ? {} : { open: data.open },
        crypto.randomUUID(),
      ),
    ),
  );

export const submitAnswers = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { collectionId: idOf(v.collectionId), values: valuesOf(v.values) };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ submissionId: string; requested: boolean }>(
        getRequest(),
        `/v1/forms/${data.collectionId}/submit`,
        { values: data.values },
        crypto.randomUUID(),
      ),
    ),
  );

/** A form opened by its link (no account). */
export const fetchLinkForm = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ token: tokenOf((input as { token?: unknown } | null)?.token) }))
  .handler(async ({ data }) => {
    const answer = await callPublic<{
      form: { name: string; description: string | null; fields: FormField[] };
    }>(`/forms/${data.token}`);
    return answer.ok ? answer.data.form : null;
  });

export const submitLinkAnswers = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { token: tokenOf(v.token), name: text(v.name, 200), values: valuesOf(v.values) };
  })
  .handler(async ({ data }) =>
    answerOf(
      await callPublic<{ submitted: boolean }>(`/forms/${data.token}/submit`, {
        method: 'POST',
        body: { ...(data.name ? { name: data.name } : {}), values: data.values },
        idempotencyKey: crypto.randomUUID(),
      }),
    ),
  );
