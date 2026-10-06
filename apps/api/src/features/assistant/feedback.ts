import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';

// What a person says of an answer (spec 053): « Utile » or « Pas utile », and why if she wants.
// One opinion per answer, hers, changed as she likes; counted for the organization's governance.

export function feedbackMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.assistant_feedback (
  feedback_id text primary key,
  organization_id text not null,
  user_id text not null,
  conversation_id text not null,
  message_id text not null check (length(message_id) between 1 and 120),
  helpful boolean not null,
  reason text check (length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, conversation_id, message_id)
);
create index assistant_feedback_recent on ${s}.assistant_feedback (organization_id, created_at desc);
${organizationPolicySql({ schema: s, table: 'assistant_feedback', appRole: options.appRole })}
grant select, insert, update on ${s}.assistant_feedback to ${options.appRole};
`;
}

const feedbackInput = z.object({
  conversationId: z.string().regex(/^cnv_[0-9a-f-]{8,64}$/),
  messageId: z.string().min(1).max(120),
  helpful: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/** How many answers were found useful since a date, out of those judged. */
export async function feedbackShare(
  db: SqlExecutor,
  since: Date,
): Promise<{ helpful: number; judged: number }> {
  const { rows } = await db.query<{ helpful: string; judged: string }>(
    `select count(*) filter (where helpful) as helpful, count(*) as judged
       from assistant_feedback where created_at >= $1`,
    [since],
  );
  return { helpful: Number(rows[0]?.helpful ?? 0), judged: Number(rows[0]?.judged ?? 0) };
}

/** Her opinion of an answer, under /v1/assistant/feedback. */
export const feedbackRoutes = new Hono<{ Variables: IdentityVariables }>().post('/', async (c) => {
  if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to judge.');
  const parsed = feedbackInput.safeParse(await bodyOf(c));
  if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'An answer and an opinion.');
  const identity = c.get('identity');
  const kept = await transaction(identity.organizationId, async (db) => {
    // Only on a conversation of hers.
    const { rows } = await db.query(
      'select 1 from assistant_conversations where conversation_id = $1 and user_id = $2',
      [parsed.data.conversationId, identity.userId],
    );
    if (rows.length === 0) throw new GestureRefusal(404, 'not_found', 'No such conversation.');
    await db.query(
      `insert into assistant_feedback (feedback_id, organization_id, user_id, conversation_id,
         message_id, helpful, reason)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (organization_id, user_id, conversation_id, message_id)
       do update set helpful = excluded.helpful, reason = excluded.reason, created_at = now()`,
      [
        newId('fdb'),
        identity.organizationId,
        identity.userId,
        parsed.data.conversationId,
        parsed.data.messageId,
        parsed.data.helpful,
        parsed.data.reason ?? null,
      ],
    );
    return { helpful: parsed.data.helpful };
  });
  return c.json(kept, 201);
});
