import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// What the chat asks the API besides its stream (spec 027): a file attached, and who and what a
// person may mention.

export interface UploadedFile {
  attachmentId: string;
  name: string;
  contentType: string;
  size: number;
  kind: 'text' | 'image';
  pages: number | null;
}

/** A file attached in the composer, read by the API now, sent with the next message. */
export const uploadAttachment = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const text = (value: unknown, max: number) =>
      typeof value === 'string' ? value.slice(0, max) : '';
    return {
      name: text(v.name, 200),
      contentType: text(v.contentType, 120),
      data: text(v.data, 14_500_000),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<UploadedFile>(
      getRequest(),
      '/v1/assistant/attachments',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, file: answer.data, error: null }
      : { ok: false as const, file: null, error: answer.error };
  });

interface DirectoryPerson {
  name: string;
  userId: string | null;
}
interface DirectoryCard extends DirectoryPerson {
  positions: { title: string; unitId: string; unitName: string }[];
  managers: DirectoryPerson[];
  reports: DirectoryPerson[];
}

export interface Mentionables {
  people: { userId: string; name: string; detail: string }[];
}

/**
 * Whom she may mention (@): her managers, her reports and the people of her units, as the directory
 * shows them to her (spec 023) — never more.
 */
export const fetchMentionables = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Mentionables> => {
    const request = getRequest();
    const me = await callApi<DirectoryCard>(request, '/v1/directory/me').catch(() => null);
    if (!me) return { people: [] };
    const people = new Map<string, { userId: string; name: string; detail: string }>();
    const add = (p: DirectoryPerson, detail: string) => {
      if (p.userId && p.userId !== me.userId && !people.has(p.userId)) {
        people.set(p.userId, { userId: p.userId, name: p.name, detail });
      }
    };
    me.managers.forEach((p) => add(p, ''));
    me.reports.forEach((p) => add(p, ''));
    for (const position of me.positions.slice(0, 3)) {
      const unit = await callApi<{ people: (DirectoryPerson & { positionTitle: string })[] }>(
        request,
        `/v1/directory/units/${position.unitId}`,
      ).catch(() => null);
      unit?.people.forEach((p) => add(p, p.positionTitle));
    }
    return { people: [...people.values()].slice(0, 60) };
  },
);
