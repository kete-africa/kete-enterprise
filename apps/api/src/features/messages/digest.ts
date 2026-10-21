import type { SqlExecutor } from '@kete/tenancy';
import { threadSummariesOf } from '@kete/threads';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { organizationName } from '../assistant/index.js';
import { queueMail, renderMail } from '../mail/index.js';
import { messageWords } from './words.js';

// The threads' summary by mail (spec 098, FR-014): who chose it in « Réglages »
// (`kete.threads_digest`, kept on her person when she opens « Pour moi ») receives, once a day
// after 18 h, the threads where something waits unread for her. Nothing unread, nothing sent.

const EVENING_HOUR = 18;

async function digestsOf(db: SqlExecutor, organizationId: string, today: string) {
  const { rows } = await db.query<{ account_user_id: string; name: string; email: string }>(
    `select account_user_id, name, email from people
      where threads_digest = 'daily' and email is not null and account_user_id is not null
        and (digest_sent_on is null or digest_sent_on < $1::date)`,
    [today],
  );
  const words = messageWords();
  let sent = 0;
  for (const person of rows) {
    const unread = (
      await threadSummariesOf(db, { kind: 'person', id: person.account_user_id })
    ).filter((t) => t.unread > 0);
    await db.query(`update people set digest_sent_on = $2::date where account_user_id = $1`, [
      person.account_user_id,
      today,
    ]);
    if (unread.length === 0) continue;
    const rendered = renderMail({
      locale: 'fr',
      sender: await organizationName(db),
      greeting: `Bonsoir ${person.name},`,
      paragraphs: [
        words.digestIntro,
        ...unread.slice(0, 30).map((t) => words.digestLine(t.thread.title, t.unread)),
      ],
      ...(env.publicWebUrl
        ? { action: { label: words.digestOpen, url: `${env.publicWebUrl}/fils` } }
        : {}),
      reason: words.digestIntro,
    });
    await queueMail(db, organizationId, {
      to: person.email,
      subject: words.digestSubject(unread.length),
      ...rendered,
      purpose: 'threads.digest',
    });
    sent += 1;
  }
  return sent;
}

/** The worker's round: each organization, after 18 h in Lomé's time (UTC), once a day. */
export async function sendDigests(now = new Date()): Promise<number> {
  if (now.getUTCHours() < EVENING_HOUR) return 0;
  const today = now.toISOString().slice(0, 10);
  const { rows } = await getPool().query<{ organization_id: string }>(
    `select organization_id from work_organizations()`,
  );
  let sent = 0;
  for (const { organization_id } of rows) {
    sent += await transaction(organization_id, (db) => digestsOf(db, organization_id, today)).catch(
      (error: unknown) => {
        console.error('[digest]', (error as Error).message);
        return 0;
      },
    );
  }
  return sent;
}
