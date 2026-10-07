import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';

// « Aujourd'hui » as a session (spec 058): she takes her day one subject at a time. A subject she
// cannot settle now is set aside for today — it leaves the session and comes back tomorrow, or
// when she takes it back. Nothing is hidden for longer than the day, and it still waits in
// « À faire ».

/** A day's subject: its kind and its id, as « Aujourd'hui » lists it. */
export const itemKey = z
  .string()
  .regex(/^(decision|draft|app_task|form|action|note):[A-Za-z0-9_.:-]{1,160}$/);

export function todaySessionMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.today_set_aside (
  organization_id text not null,
  user_id text not null,
  item_key text not null check (length(item_key) between 3 and 200),
  day date not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, item_key, day)
);
${organizationPolicySql({ schema: s, table: 'today_set_aside', appRole: options.appRole })}
grant select, insert, delete on ${s}.today_set_aside to ${options.appRole};
`;
}

/** Lomé's day, which is UTC's all year. */
const today = () => new Date().toISOString().slice(0, 10);

/** What she set aside today. */
export async function setAsideOf(
  db: SqlExecutor,
  userId: string,
  day = today(),
): Promise<string[]> {
  const { rows } = await db.query<{ item_key: string }>(
    'select item_key from today_set_aside where user_id = $1 and day = $2 order by created_at',
    [userId, day],
  );
  return rows.map((r) => r.item_key);
}

/** Her session's gestures, under /v1/today: hers alone. */
export const todaySessionRoutes = new Hono<{ Variables: IdentityVariables }>()
  // « Plus tard aujourd'hui »: the subject leaves today's session; yesterday's are forgotten.
  .post('/later', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Her day is hers.');
    const parsed = z.object({ key: itemKey }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A subject of the day.');
    const { organizationId, userId } = c.get('identity');
    await transaction(organizationId, async (db) => {
      await db.query('delete from today_set_aside where user_id = $1 and day < $2', [
        userId,
        today(),
      ]);
      await db.query(
        `insert into today_set_aside (organization_id, user_id, item_key, day)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [organizationId, userId, parsed.data.key, today()],
      );
    });
    return c.json({ later: true });
  })
  // « Reprendre »: one subject, or all of them when none is named.
  .post('/resume', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Her day is hers.');
    const parsed = z.object({ key: itemKey.optional() }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A subject of the day.');
    const { organizationId, userId } = c.get('identity');
    await transaction(organizationId, (db) =>
      db.query(
        `delete from today_set_aside
          where user_id = $1 and day = $2 and ($3::text is null or item_key = $3)`,
        [userId, today(), parsed.data.key ?? null],
      ),
    );
    return c.json({ resumed: true });
  });
