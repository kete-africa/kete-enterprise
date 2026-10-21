import type { SqlExecutor } from '@kete/tenancy';
import { joinThread, openThread } from '@kete/threads';
import { z } from 'zod';
import { env } from '../../platform/env.js';

// A thread born with its object (spec 098, FR-010). A project and a third party open theirs when
// they are created; those made before get theirs the first time their threads are listed. An app's
// object — a ticket, an invoice, a quote, a contract, a leave — gets its thread when the app says so
// with the person's token: she holds it, its address in the app is kept for « Ouvrir la fiche », and
// the third party's mail joins, so an answer « au client » can reach it.

/** The projects and third parties of the organization that have no thread yet get theirs. */
export async function ensureObjectThreads(
  db: SqlExecutor,
  organizationId: string,
): Promise<number> {
  const { rows } = await db.query<{
    kind: 'project' | 'party';
    id: string;
    title: string;
    holder: string;
  }>(
    `select 'project' as kind, p.project_id as id, p.name as title, p.lead_user_id as holder
       from projects p
      where p.status = 'open'
        and not exists (select 1 from kete_threads t
                         where t.kind = 'object' and t.object_kind = 'project'
                           and t.object_id = p.project_id)
     union all
     select 'party', y.party_id, y.name, y.created_by from parties y
      where y.status = 'active' and y.created_by is not null
        and not exists (select 1 from kete_threads t
                         where t.kind = 'object' and t.object_kind = 'party'
                           and t.object_id = y.party_id)
      limit 200`,
  );
  for (const row of rows) {
    await openThread(db, organizationId, {
      kind: 'object',
      object: { kind: row.kind, id: row.id },
      title: row.title.slice(0, 200),
      holder: { kind: 'person', id: row.holder },
    });
  }
  return rows.length;
}

export const appObjectInput = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  href: z
    .string()
    .max(500)
    .refine((v) => v.startsWith('https://') || /^http:\/\/127\.0\.0\.1:\d+\//.test(v))
    .optional(),
  party: z.string().min(1).max(100).optional(),
  project: z.string().min(1).max(100).optional(),
});

/** An app's object's thread, opened (or found again) for the person who created it. */
export async function openAppObjectThread(
  db: SqlExecutor,
  organizationId: string,
  input: { product: string; userId: string; object: z.infer<typeof appObjectInput> },
): Promise<{ threadId: string; href: string }> {
  const { object } = input;
  const thread = await openThread(db, organizationId, {
    kind: 'object',
    object: { kind: object.kind, id: object.id },
    title: object.title,
    holder: { kind: 'person', id: input.userId },
  });
  await db.query(
    `insert into thread_objects (organization_id, thread_id, product, href, party_id, project_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (thread_id) do update
       set href = coalesce(excluded.href, thread_objects.href),
           party_id = coalesce(excluded.party_id, thread_objects.party_id),
           project_id = coalesce(excluded.project_id, thread_objects.project_id)`,
    [
      organizationId,
      thread.id,
      input.product,
      object.href ?? null,
      object.party ?? null,
      object.project ?? null,
    ],
  );
  await joinThread(db, organizationId, thread.id, { kind: 'person', id: input.userId });
  if (object.party) {
    const { rows } = await db.query<{ email: string | null }>(
      `select email from parties where party_id = $1 and status = 'active'`,
      [object.party],
    );
    const email = rows[0]?.email?.trim().toLowerCase();
    if (email) {
      await joinThread(db, organizationId, thread.id, { kind: 'contact', id: `mail:${email}` });
    }
  }
  return { threadId: thread.id, href: `${env.publicWebUrl}/fils?fil=${thread.id}` };
}

/** The third party of a thread's object, when there is one: whom its outside words reach. */
export async function partyOfThread(
  db: SqlExecutor,
  thread: { id: string; object?: { kind: string; id: string } },
): Promise<string | null> {
  if (!thread.object) return null;
  if (thread.object.kind === 'party') return thread.object.id;
  if (thread.object.kind === 'project') {
    const { rows } = await db.query<{ party_id: string | null }>(
      `select party_id from projects where project_id = $1`,
      [thread.object.id],
    );
    return rows[0]?.party_id ?? null;
  }
  const { rows } = await db.query<{ party_id: string | null }>(
    `select party_id from thread_objects where thread_id = $1`,
    [thread.id],
  );
  return rows[0]?.party_id ?? null;
}
