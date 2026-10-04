import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { LibraryDocument } from './knowledge';

// Dossiers (spec 034), as the API serves them.

export interface Dossier {
  dossierId: string;
  name: string;
  description: string | null;
  sourceId: string;
  createdAt: string;
  archived: boolean;
  role: 'owner' | 'member' | null;
  members: number;
}
export interface DossierMember {
  userId: string;
  name: string;
  role: 'owner' | 'member';
}
export interface DossierLink {
  linkId: string;
  kind: 'conversation' | 'action' | 'decision' | 'app' | 'url';
  ref: string;
  title: string;
  href: string;
  addedBy: string;
  addedAt: string;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown) => {
  const id = text(value, 80);
  if (!/^dos_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which dossier?');
  return id;
};
const done = (answer: { ok: boolean; error?: string | null }) =>
  answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error ?? null };

export const fetchDossiers = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ dossiers: Dossier[] }>(getRequest(), '/v1/dossiers'),
);

export const fetchDossier = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    dossierId: idOf((input as { dossierId?: unknown } | null)?.dossierId),
  }))
  .handler(({ data }) =>
    callApi<{
      dossier: Dossier;
      members: DossierMember[];
      links: DossierLink[];
      documents: LibraryDocument[];
    }>(getRequest(), `/v1/dossiers/${data.dossierId}`),
  );

export const createDossier = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { name: text(v.name, 160), description: text(v.description, 1000) };
  })
  .handler(async ({ data }) =>
    done(
      await sendGesture(
        getRequest(),
        '/v1/dossiers',
        { name: data.name, ...(data.description ? { description: data.description } : {}) },
        crypto.randomUUID(),
      ),
    ),
  );

/** A gesture on one dossier: its path below the dossier, and its body. */
export const dossierGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const path = text(v.path, 200);
    if (
      !/^(|\/members|\/members\/[\w-]+\/remove|\/links|\/links\/dln_[\w-]+\/remove|\/documents|\/documents\/kdoc_[\w-]+\/remove)$/.test(
        path,
      )
    ) {
      throw new Error('Which gesture?');
    }
    return { dossierId: idOf(v.dossierId), path, body: (v.body ?? {}) as Record<string, unknown> };
  })
  .handler(async ({ data }) =>
    done(
      await sendGesture(
        getRequest(),
        `/v1/dossiers/${data.dossierId}${data.path}`,
        data.body,
        crypto.randomUUID(),
      ),
    ),
  );

export const searchDossier = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { dossierId: idOf(v.dossierId), q: text(v.q, 500) };
  })
  .handler(({ data }) =>
    callApi<{ hits: { label: string; text: string; documentId: string }[] }>(
      getRequest(),
      `/v1/dossiers/${data.dossierId}/search?q=${encodeURIComponent(data.q)}`,
    ),
  );
