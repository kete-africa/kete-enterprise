import type { SqlExecutor } from '@kete/tenancy';
import { whoToTell } from '@kete/threads';
import { getPool, transaction } from '../../platform/db.js';
import { ring } from '../notifications/index.js';
import { workOrganizations } from '../work/index.js';
import { messageWords } from './words.js';

// A message on her phone at the right moment (spec 099, FR-005): the app shows it at once; her
// phone rings only if she has not read it three minutes after — as her level for the thread wants
// it (all, her mentions, nothing), always when she must act. Once per message and person.

const LATER_MINUTES = 3;

async function ringOrganization(db: SqlExecutor, organizationId: string): Promise<number> {
  const { rows } = await db.query<{
    message_id: string;
    thread_id: string;
    title: string;
    text: string;
    author_kind: string;
    author_id: string;
    attachments: { media_type?: string }[];
  }>(
    `select m.message_id, m.thread_id, t.title, m.text, m.author_kind, m.author_id, m.attachments
       from kete_messages m join kete_threads t using (thread_id)
      where m.edited_from is null and m.import_key is null
        and m.at between now() - interval '20 minutes' and now() - interval '${LATER_MINUTES} minutes'
      order by m.at`,
  );
  const words = messageWords();
  let rung = 0;
  for (const message of rows) {
    const told = await whoToTell(db, message.message_id);
    if (told.length === 0) continue;
    const { rows: people } = await db.query<{ name: string }>(
      `select name from people where account_user_id = $1 limit 1`,
      [message.author_id],
    );
    const author =
      people[0]?.name ?? (message.author_kind === 'agent' ? words.keteThread : words.outsider);
    const voice = message.attachments.some((file) => file.media_type?.startsWith('audio/'));
    for (const person of told) {
      if (person.kind !== 'person') continue;
      const { rows: done } = await db.query(
        `insert into thread_pushes (organization_id, message_id, user_id)
         values ($1, $2, $3) on conflict do nothing returning message_id`,
        [organizationId, message.message_id, person.id],
      );
      if (done.length === 0) continue;
      rung += await ring(db, person.id, {
        kind: 'thread.message',
        title: words.pushed(author, message.title),
        body: (message.text || (voice ? words.voiceNote : '')).slice(0, 140),
        href: `/fils?fil=${message.thread_id}#${message.message_id}`,
      });
    }
  }
  return rung;
}

/** Rings, in every organization, what is still unread three minutes after it was said. */
export async function ringUnread(): Promise<number> {
  let rung = 0;
  for (const organizationId of await workOrganizations(getPool())) {
    rung += await transaction(organizationId, (db) => ringOrganization(db, organizationId)).catch(
      (error: unknown) => {
        console.error(`[threads] ringing ${organizationId}`, (error as Error).message);
        return 0;
      },
    );
  }
  return rung;
}
