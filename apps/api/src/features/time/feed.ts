import { createHash, randomBytes } from 'node:crypto';
import type { SqlExecutor } from '@kete/tenancy';
import { icsFeed } from '@kete/time';
import { forMe } from '@kete/work';
import { Hono } from 'hono';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { factsBetween } from './time.js';

// Planifier in Outlook (spec 098, FR-018; kete-core spec 139): a person's days as an iCalendar feed
// her calendar subscribes to, under a secret address. Only the token's hash is kept: the address is
// shown once, when it is made; renewing it closes the old one. What the feed carries is hers alone —
// the facts that concern her and the due days of what she holds —, never anyone else's.

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const addressOf = (token: string) => `${env.publicApiUrl}/public/agenda/${token}.ics`;

/** Her feed's address, made anew: the previous one stops answering. */
async function renew(db: SqlExecutor, organizationId: string, userId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await db.query(
    `insert into agenda_feeds (organization_id, user_id, token_hash) values ($1, $2, $3)
     on conflict (organization_id, user_id)
       do update set token_hash = excluded.token_hash, created_at = now()`,
    [organizationId, userId, hashOf(token)],
  );
  return addressOf(token);
}

/** Her days, as the feed says them: her facts from a week ago to two months ahead, her due days. */
async function daysOf(db: SqlExecutor, userId: string, name: string): Promise<string> {
  const facts = (await factsBetween(db, day(-7), day(60))).filter(
    (fact) => (fact.person_ids ?? []).includes(userId) && fact.visibility !== 'private',
  );
  const mine = await forMe(db, userId);
  const due = [...mine.held, ...mine.toAnswer]
    .filter((h) => h.due !== null)
    .map((h) => ({
      key: `due_${h.holdingId}`,
      kind: 'deadline' as const,
      label: h.what,
      day: h.due as string,
      ...(env.publicWebUrl ? { href: `${env.publicWebUrl}/pour-moi` } : {}),
    }));
  return icsFeed([...facts, ...due], { name: `Kete — ${name}` });
}

/** Her feed, under /v1/time/feed: whether she has one, and a new address on demand. */
export const feedRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const { rows } = await transaction(organizationId, (db) =>
      db.query<{ created_at: Date }>(`select created_at from agenda_feeds where user_id = $1`, [
        userId,
      ]),
    );
    return c.json({ since: rows[0] ? new Date(rows[0].created_at).toISOString() : null });
  })
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to make.');
    const { organizationId, userId } = c.get('identity');
    const address = await transaction(organizationId, (db) => renew(db, organizationId, userId));
    return c.json({ address }, 201);
  });

/** `GET /public/agenda/:token.ics`: what a calendar reads, without an account. */
export const feedPublicRoutes = new Hono().get('/:file', async (c) => {
  const token = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(c.req.param('file'))?.[1];
  if (!token) return c.text('', 404);
  const { rows } = await getPool().query<{ organization_id: string; user_id: string }>(
    `select organization_id, user_id from agenda_feed_owner($1)`,
    [hashOf(token)],
  );
  const owner = rows[0];
  if (!owner) return c.text('', 404);
  const ics = await transaction(owner.organization_id, async (db) => {
    const { rows: people } = await db.query<{ name: string }>(
      `select name from people where account_user_id = $1`,
      [owner.user_id],
    );
    return daysOf(db, owner.user_id, people[0]?.name ?? 'Planifier');
  });
  return c.body(ics, 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'cache-control': 'private, max-age=300',
  });
});
