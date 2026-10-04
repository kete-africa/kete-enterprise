import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { notificationWords, tell } from '../notifications/index.js';

/**
 * Tasks of the team's apps (spec 018): a connected app — the helpdesk for a ticket a person took —
 * puts what waits for her in her one « To do », with her own token, and closes it when it is done.
 * A task is the person's: an app reaches only the person whose token it holds. One task per app
 * and key, so sending it again updates it.
 */
export function appTasksMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.app_tasks (
  task_id text primary key,
  organization_id text not null,
  user_id text not null,
  source text not null check (length(source) between 1 and 80),
  key text not null check (length(key) between 1 and 120),
  title text not null check (length(title) between 1 and 300),
  href text not null check (href like 'https://%'),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, source, key)
);
create index app_tasks_open on ${s}.app_tasks (organization_id, user_id, status, due_at);
${organizationPolicySql({ schema: s, table: 'app_tasks', appRole: options.appRole })}
grant select, insert, update on ${s}.app_tasks to ${options.appRole};
`;
}

export interface AppTask {
  taskId: string;
  source: string;
  title: string;
  href: string;
  dueAt: string | null;
  overdue: boolean;
}

export async function openTasksOf(db: SqlExecutor, userId: string): Promise<AppTask[]> {
  const { rows } = await db.query<{
    task_id: string;
    source: string;
    title: string;
    href: string;
    due_at: Date | null;
  }>(
    `select task_id, source, title, href, due_at from app_tasks
      where user_id = $1 and status = 'open' order by due_at nulls last, created_at limit 100`,
    [userId],
  );
  const now = Date.now();
  return rows.map((r) => ({
    taskId: r.task_id,
    source: r.source,
    title: r.title,
    href: r.href,
    dueAt: r.due_at?.toISOString() ?? null,
    overdue: r.due_at !== null && r.due_at.getTime() < now,
  }));
}

/**
 * Puts a task in a person's « To do », or updates it: one per source and key. Apps send theirs with
 * the person's token; her assistant puts the answers of her scheduled tasks (spec 029).
 */
export async function putTask(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  task: { source: string; key: string; title: string; href: string; dueAt?: string | undefined },
): Promise<string | undefined> {
  const { rows } = await db.query<{ task_id: string }>(
    `insert into app_tasks (task_id, organization_id, user_id, source, key, title, href, due_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (organization_id, user_id, source, key) do update
       set title = excluded.title, href = excluded.href, due_at = excluded.due_at,
           status = 'open', updated_at = now()
     returning task_id`,
    [
      newId('tsk'),
      organizationId,
      userId,
      task.source,
      task.key,
      task.title,
      task.href,
      task.dueAt ?? null,
    ],
  );
  return rows[0]?.task_id;
}

const taskInput = z.object({
  source: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  href: z.string().url().startsWith('https://'),
  dueAt: z.string().datetime({ offset: true }).optional(),
});

const closeInput = z.object({
  source: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(120),
});

/** The routes of the apps' tasks, under /v1/workspace/tasks. */
export const appTasksRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({ tasks: await transaction(organizationId, (db) => openTasksOf(db, userId)) });
  })
  .post('/', async (c) => {
    const parsed = taskInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A task is not valid.');
    const { organizationId, userId } = c.get('identity');
    const task = parsed.data;
    const taskId = await transaction(organizationId, async (db) => {
      const id = await putTask(db, organizationId, userId, task);
      await tell(db, organizationId, userId, {
        kind: 'task.added',
        title: notificationWords().taskAdded(task.source, task.title),
        href: task.href,
      });
      return id;
    });
    return c.json({ taskId }, 201);
  })
  .post('/close', async (c) => {
    const parsed = closeInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Which task?');
    const { organizationId, userId } = c.get('identity');
    await transaction(organizationId, (db) =>
      db.query(
        `update app_tasks set status = 'done', updated_at = now()
          where user_id = $1 and source = $2 and key = $3`,
        [userId, parsed.data.source, parsed.data.key],
      ),
    );
    return c.json({ status: 'done' });
  });
