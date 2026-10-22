import type { Received, RouterOptions } from '@kete/channels';
import { listChatSenders } from '@kete/notify';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { readModules } from '../organization/index.js';

// Mail as decided (spec 099, FR-018; canvas v6.2, « Mails et conversations »): a shared box is
// read whole; a personal box only for what touches the organization's objects — a mail with a
// known contact, the « Kete » folder she drops a mail in, a thread's address in copy, an answer to
// a mail a thread knows —, and its Sent folder by the same rule. Never the rest: a personal mail,
// or one between colleagues, enters no thread without a gesture of hers. What each routing step
// placed this week is counted; a mail shows cleaned, its original one tap away.

export function mailSettingsMigrationSql(options: { schema: string }): string {
  const s = options.schema;
  return `
alter table ${s}.mailbox_accounts
  add column label text check (length(label) <= 120),
  add column sent_folder text not null default 'Sent' check (length(sent_folder) between 1 and 200),
  add column kete_folder text not null default 'Kete' check (length(kete_folder) between 1 and 200);
`;
}

/** What Kete reads in a box: whole when shared; a personal one by the three rules. */
export const mailRulesInput = z.object({
  kind: z.enum(['personal', 'shared']),
  label: z.string().trim().max(120).optional(),
  readSent: z.boolean(),
  sentFolder: z.string().trim().min(1).max(200).default('Sent'),
  keteFolder: z.string().trim().min(1).max(200).default('Kete'),
});

export async function setMailRules(
  db: SqlExecutor,
  userId: string,
  rules: z.output<typeof mailRulesInput>,
): Promise<boolean> {
  const { rows } = await db.query(
    `update mailbox_accounts set kind = $2, label = $3, read_sent = $4, sent_folder = $5,
            kete_folder = $6, updated_at = now()
      where user_id = $1 returning user_id`,
    [userId, rules.kind, rules.label || null, rules.readSent, rules.sentFolder, rules.keteFolder],
  );
  return rows.length > 0;
}

/**
 * Whether a mail of a personal box touches the organization's objects (FR-018): an answer to a
 * mail a thread knows, a thread's address among its recipients, or — for each one it is with, its
 * sender when received, its recipients when sent — a contact the center knows.
 */
export function touchesObjects(db: SqlExecutor, options: RouterOptions) {
  return async (received: Received): Promise<boolean> => {
    const refs = [received.inReplyTo, ...(received.references ?? [])].filter((ref): ref is string =>
      Boolean(ref),
    );
    if (refs.length > 0) {
      const { rows } = await db.query(`select 1 from kete_mail_refs where ref = any($1) limit 1`, [
        refs,
      ]);
      if (rows.length > 0) return true;
    }
    const recipients = received.to.map((address) => address.toLowerCase());
    if (recipients.length > 0) {
      const { rows } = await db.query(
        `select 1 from kete_threads where address = any($1) and state = 'open' limit 1`,
        [recipients],
      );
      if (rows.length > 0) return true;
    }
    const others =
      received.direction === 'out'
        ? recipients
        : [received.from.address?.toLowerCase() ?? ''].filter(Boolean);
    for (const address of others) {
      const domain = address.split('@')[1] ?? '';
      const { rows } = await db.query(
        `select 1 from kete_routing_rules where match = $1 or match = $2
         union all
         select 1 from parties where status = 'active' and lower(email) = $3
         limit 1`,
        [`mail:${address}`, `domain:${domain}`, address],
      );
      if (rows.length > 0) return true;
      const as: Received = {
        ...received,
        from: { key: `mail:${address}`, name: null, phone: null, address },
      };
      if (options.known && (await options.known(as))) return true;
    }
    return false;
  };
}

export type RoutingStep = 'reply' | 'address' | 'contact' | 'model' | 'classify';

/**
 * What Kete reads and how it ranges, for administrators (FR-018): each box with what it reads and
 * how many mails it placed this week; how many each routing step placed; the threads' domain and
 * the channels heard live.
 */
export async function mailOverview(db: SqlExecutor) {
  const { rows: boxes } = await db.query<{
    user_id: string;
    address: string;
    kind: 'personal' | 'shared';
    label: string | null;
    read_sent: boolean;
    sent_folder: string;
    kete_folder: string;
    active: boolean;
    week: string;
  }>(
    `select b.user_id, b.address, b.kind, b.label, b.read_sent, b.sent_folder, b.kete_folder,
            b.active,
            (select count(*) from kete_routings r
              where r.via = 'mail' and r.at >= now() - interval '7 days'
                and (lower(r.received -> 'from' ->> 'address') = lower(b.address)
                     or exists (select 1 from jsonb_array_elements_text(r.received -> 'to') t
                                 where lower(t) = lower(b.address)))) as week
       from mailbox_accounts b order by b.kind desc, b.address`,
  );
  const { rows: steps } = await db.query<{ step: RoutingStep; n: string }>(
    `select case
              when asked is not null then 'classify'
              when intent = 'reply' and received ? 'inReplyTo' then 'reply'
              when intent = 'reply' then 'address'
              when by = 'rule' then 'contact'
              else 'model'
            end as step, count(*) as n
       from kete_routings
      where via = 'mail' and at >= now() - interval '7 days' and by <> 'person'
      group by 1`,
  );
  const counted = Object.fromEntries(steps.map((s) => [s.step, Number(s.n)])) as Partial<
    Record<RoutingStep, number>
  >;
  const senders = await listChatSenders(db).catch(() => []);
  const modules = await readModules(db);
  return {
    mailboxes: boxes.map((b) => ({
      userId: b.user_id,
      address: b.address,
      kind: b.kind,
      label: b.label,
      readSent: b.read_sent,
      sentFolder: b.sent_folder,
      keteFolder: b.kete_folder,
      active: b.active,
      week: Number(b.week),
    })),
    steps: {
      reply: counted.reply ?? 0,
      address: counted.address ?? 0,
      contact: counted.contact ?? 0,
      model: counted.model ?? 0,
      classify: counted.classify ?? 0,
    },
    /** The threads' own domain: not chosen yet, a thread has no address of its own. */
    domain: process.env.KETE_THREAD_DOMAIN?.trim() || null,
    live: {
      whatsapp: senders.some((s) => s.channel === 'whatsapp'),
      telegram: senders.some((s) => s.channel === 'telegram'),
      form: Boolean((modules as Record<string, boolean>)['forms']),
    },
  };
}

/**
 * The mails of a thread as they came (FR-018): a message the router posted and the routing it
 * journaled share their instant; its original is what « Voir le mail d'origine » shows.
 */
export async function originalsOf(
  db: SqlExecutor,
  threadId: string,
  messages: { first: string; via: string; at: string }[],
): Promise<Record<string, string>> {
  const mails = messages.filter((m) => m.via === 'mail');
  if (mails.length === 0) return {};
  const { rows } = await db.query<{ at: Date; original: string | null }>(
    `select at, received ->> 'original' as original from kete_routings
      where thread_id = $1 and via = 'mail' and at = any($2::timestamptz[])`,
    [threadId, mails.map((m) => m.at)],
  );
  const byAt = new Map(rows.map((r) => [new Date(r.at).toISOString(), r.original]));
  const found: Record<string, string> = {};
  for (const mail of mails) {
    const original = byAt.get(new Date(mail.at).toISOString());
    if (original) found[mail.first] = original;
  }
  return found;
}
