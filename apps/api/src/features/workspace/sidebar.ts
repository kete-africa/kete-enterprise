import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';

// The sidebar the person arranges (spec 049): the places she hides, her shortcuts to anything she
// reads — a dashboard, a dossier, an agent, a conversation, an app, a place — in sections she
// names and orders. Hers alone; the pages a shortcut opens still check her rights.

export function sidebarMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.sidebar_layouts (
  organization_id text not null,
  user_id text not null,
  layout jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'sidebar_layouts', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.sidebar_layouts to ${options.appRole};
`;
}

/** What a shortcut opens: the screen resolves its address and its icon from its kind. */
export const shortcutKinds = [
  'place',
  'dashboard',
  'dossier',
  'agent',
  'conversation',
  'app',
  'link',
] as const;

const shortcut = z
  .object({
    kind: z.enum(shortcutKinds),
    ref: z.string().min(1).max(200),
    label: z.string().trim().min(1).max(120),
  })
  .refine(
    // A link stays inside the space: a path, never another site or a script.
    (s) => s.kind !== 'link' || /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]*$/.test(s.ref),
    { message: 'A link is a path of the space.' },
  )
  .refine((s) => s.kind === 'link' || /^[A-Za-z0-9_.:-]+$/.test(s.ref), {
    message: 'A reference is an identifier.',
  });
export type Shortcut = z.infer<typeof shortcut>;

export const sidebarLayout = z.object({
  /** The places she hides; « Aujourd'hui » and « À faire » always stay. */
  hidden: z
    .array(z.string().regex(/^[a-z_]+$/))
    .max(30)
    .default([])
    .transform((h) => [...new Set(h)].filter((p) => p !== 'home' && p !== 'todo')),
  sections: z
    .array(
      z.object({
        /** None: the screen's own word, « Épinglés ». */
        name: z.string().trim().min(1).max(40).nullable(),
        items: z.array(shortcut).max(30),
      }),
    )
    .min(1)
    .max(8),
});
export type SidebarLayout = z.infer<typeof sidebarLayout>;

const proposed = (): SidebarLayout => ({ hidden: [], sections: [{ name: null, items: [] }] });

export async function sidebarOf(db: SqlExecutor, userId: string): Promise<SidebarLayout> {
  const { rows } = await db.query<{ layout: unknown }>(
    'select layout from sidebar_layouts where user_id = $1',
    [userId],
  );
  const parsed = sidebarLayout.safeParse(rows[0]?.layout);
  return parsed.success ? parsed.data : proposed();
}

async function keep(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  layout: SidebarLayout,
): Promise<SidebarLayout> {
  await db.query(
    `insert into sidebar_layouts (organization_id, user_id, layout) values ($1, $2, $3)
     on conflict (organization_id, user_id) do update set layout = excluded.layout, updated_at = now()`,
    [organizationId, userId, JSON.stringify(layout)],
  );
  return layout;
}

const same = (a: Pick<Shortcut, 'kind' | 'ref'>) => (b: Shortcut) =>
  a.kind === b.kind && a.ref === b.ref;

/** Her sidebar, under /v1/sidebar: read, pin, unpin, arrange — never while viewing another's. */
export const sidebarRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const identity = c.get('identity');
    const layout = await transaction(identity.organizationId, (db) =>
      sidebarOf(db, identity.userId),
    );
    return c.json({ layout });
  })
  .post('/pin', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to pin.');
    const parsed = shortcut.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What to pin?');
    const identity = c.get('identity');
    const layout = await transaction(identity.organizationId, async (db) => {
      const current = await sidebarOf(db, identity.userId);
      if (current.sections.some((s) => s.items.some(same(parsed.data)))) return current;
      const first = current.sections[0];
      if (!first || first.items.length >= 30) {
        throw new GestureRefusal(409, 'full', 'Her first section is full.');
      }
      first.items.push(parsed.data);
      return keep(db, identity.organizationId, identity.userId, current);
    });
    return c.json({ layout });
  })
  .post('/unpin', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to unpin.');
    const parsed = z
      .object({ kind: z.enum(shortcutKinds), ref: z.string().min(1).max(200) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What to unpin?');
    const identity = c.get('identity');
    const layout = await transaction(identity.organizationId, async (db) => {
      const current = await sidebarOf(db, identity.userId);
      for (const section of current.sections) {
        section.items = section.items.filter((i) => !same(parsed.data)(i));
      }
      return keep(db, identity.organizationId, identity.userId, current);
    });
    return c.json({ layout });
  })
  // She arranges it at once: hidden places, sections, their order and their shortcuts.
  .post('/arrange', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to arrange.');
    const parsed = z.object({ layout: sidebarLayout }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A sidebar to keep.');
    const identity = c.get('identity');
    const layout = await transaction(identity.organizationId, (db) =>
      keep(db, identity.organizationId, identity.userId, parsed.data.layout),
    );
    return c.json({ layout });
  })
  // Back to the sidebar Kete proposes.
  .post('/reset', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to reset.');
    const identity = c.get('identity');
    await transaction(identity.organizationId, (db) =>
      db.query('delete from sidebar_layouts where user_id = $1', [identity.userId]),
    );
    return c.json({ layout: proposed() });
  });
