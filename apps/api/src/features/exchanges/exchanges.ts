import type { KeteIdentity } from '@kete/auth';
import type { CapabilityTool } from '@kete/capabilities';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { colleagueCard } from '../directory/index.js';
import { notificationWords, tell } from '../notifications/index.js';
import { readChartAt } from '../structure/index.js';
import { closeTask, openTasksOf, putTask } from '../workspace/index.js';

// Exchanges between assistants (spec 057, doctrine D-039): a person's assistant asks a
// colleague's. The colleague's assistant answers alone only on the subjects she allowed, with
// facts computed by rule — never a model reading her space for someone else; anything else is
// passed to her, in her « À faire ». Both see every exchange; nothing is allowed by default.

/** Who asks, or settles: the person behind the token, in her organization. */
type Asker = Pick<IdentityVariables['identity'], 'organizationId' | 'userId' | 'role' | 'name'>;

/** What a person may let her assistant answer alone. */
export const subjects = ['availability', 'workload'] as const;
export type Subject = (typeof subjects)[number];
const asked = [...subjects, 'other'] as const;

/** The most a person's assistant asks in a day: assistants do not flood each other. */
export const MAX_ASKED_PER_DAY = 30;
/** How far ahead « availability » looks. */
const AHEAD_DAYS = 7;

export function exchangesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.assistant_exchange_settings (
  organization_id text not null,
  user_id text not null,
  subjects text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'assistant_exchange_settings', appRole: options.appRole })}
grant select, insert, update on ${s}.assistant_exchange_settings to ${options.appRole};

create table ${s}.assistant_exchanges (
  exchange_id text primary key,
  organization_id text not null,
  from_user_id text not null,
  from_name text not null check (length(from_name) <= 200),
  to_user_id text not null,
  to_name text not null check (length(to_name) <= 200),
  subject text not null check (subject in ('availability', 'workload', 'other')),
  question text not null check (length(question) between 1 and 1000),
  status text not null
    check (status in ('answered', 'waiting', 'replied', 'declined', 'withdrawn')),
  answer text check (length(answer) <= 2000),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index assistant_exchanges_to on ${s}.assistant_exchanges (organization_id, to_user_id, created_at desc);
create index assistant_exchanges_from on ${s}.assistant_exchanges (organization_id, from_user_id, created_at desc);
${organizationPolicySql({ schema: s, table: 'assistant_exchanges', appRole: options.appRole })}
grant select, insert, update on ${s}.assistant_exchanges to ${options.appRole};
`;
}

export interface Exchange {
  exchangeId: string;
  from: { userId: string; name: string };
  to: { userId: string; name: string };
  subject: (typeof asked)[number];
  question: string;
  /** answered: by her assistant alone · waiting: passed to her · replied, declined: by her. */
  status: 'answered' | 'waiting' | 'replied' | 'declined' | 'withdrawn';
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

type Row = {
  exchange_id: string;
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  subject: Exchange['subject'];
  question: string;
  status: Exchange['status'];
  answer: string | null;
  created_at: Date;
  answered_at: Date | null;
};
const exchangeOf = (r: Row): Exchange => ({
  exchangeId: r.exchange_id,
  from: { userId: r.from_user_id, name: r.from_name },
  to: { userId: r.to_user_id, name: r.to_name },
  subject: r.subject,
  question: r.question,
  status: r.status,
  answer: r.answer,
  createdAt: r.created_at.toISOString(),
  answeredAt: r.answered_at?.toISOString() ?? null,
});

export async function allowedSubjects(db: SqlExecutor, userId: string): Promise<Subject[]> {
  const { rows } = await db.query<{ subjects: string[] }>(
    'select subjects from assistant_exchange_settings where user_id = $1',
    [userId],
  );
  return subjects.filter((subject) => rows[0]?.subjects.includes(subject));
}

async function allow(
  db: SqlExecutor,
  person: { organizationId: string; userId: string },
  allowed: Subject[],
): Promise<void> {
  await db.query(
    `insert into assistant_exchange_settings (organization_id, user_id, subjects)
     values ($1, $2, $3)
     on conflict (organization_id, user_id) do update
       set subjects = excluded.subjects, updated_at = now()`,
    [person.organizationId, person.userId, allowed],
  );
}

/** Her exchanges, received and sent, the latest first. */
export async function exchangesOf(
  db: SqlExecutor,
  userId: string,
): Promise<{ received: Exchange[]; sent: Exchange[] }> {
  const { rows } = await db.query<Row>(
    `select * from assistant_exchanges where to_user_id = $1 or from_user_id = $1
      order by created_at desc limit 100`,
    [userId],
  );
  const all = rows.map(exchangeOf);
  return {
    received: all.filter((e) => e.to.userId === userId && e.status !== 'withdrawn'),
    sent: all.filter((e) => e.from.userId === userId),
  };
}

/** Lomé's local time, which is UTC all year: « mar. 07/10 à 10:00 ». */
const moment = (at: Date) =>
  `${at.toISOString().slice(8, 10)}/${at.toISOString().slice(5, 7)} à ${at.toISOString().slice(11, 16)}`;

/**
 * What her assistant says alone, by rule: moments and counts, never a title, a source or a name.
 * No calendar is connected: « availability » knows only her dated commitments in « À faire ».
 */
async function answerAlone(
  db: SqlExecutor,
  userId: string,
  subject: Subject,
  now: Date,
): Promise<{ text: string; facts: Record<string, unknown> }> {
  const tasks = await openTasksOf(db, userId);
  if (subject === 'workload') {
    const overdue = tasks.filter((t) => t.overdue).length;
    return {
      text: `${tasks.length} chose(s) attendent dans son « À faire », dont ${overdue} en retard.`,
      facts: { waiting: tasks.length, overdue },
    };
  }
  const until = new Date(now.getTime() + AHEAD_DAYS * 86_400_000);
  const busy = tasks
    .flatMap((t) => (t.dueAt ? [new Date(t.dueAt)] : []))
    .filter((at) => at >= now && at <= until)
    .sort((a, b) => a.getTime() - b.getTime());
  const limit =
    'Kete ne connaît que ses engagements datés : aucun agenda n’est connecté, elle peut avoir d’autres rendez-vous.';
  return {
    text: busy.length
      ? `Moments pris dans les ${AHEAD_DAYS} jours (heure de Lomé) : ${busy.map(moment).join(' ; ')}. ${limit}`
      : `Aucun engagement daté dans les ${AHEAD_DAYS} jours. ${limit}`,
    facts: { busyAt: busy.map((at) => at.toISOString()), days: AHEAD_DAYS, calendar: false },
  };
}

export class ExchangeRefusal extends Error {
  constructor(readonly reason: 'not_found' | 'ambiguous' | 'herself' | 'too_many') {
    super(reason);
  }
}

/** The colleague a name or an account points to, as the directory shows her to the asker. */
async function colleagueOf(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
  who: string,
): Promise<{ userId: string; name: string }> {
  const chart = await readChartAt(db, new Date().toISOString().slice(0, 10));
  const known = chart.people.filter((p) => p.accountUserId);
  const wanted = who.trim().toLowerCase();
  const byAccount = known.filter((p) => p.accountUserId === who.trim());
  const found = byAccount.length
    ? byAccount
    : known.filter((p) => p.name.trim().toLowerCase() === wanted);
  const close = found.length
    ? found
    : known.filter((p) => p.name.toLowerCase().split(/\s+/).includes(wanted));
  if (close.length > 1) throw new ExchangeRefusal('ambiguous');
  const userId = close[0]?.accountUserId;
  if (!userId) throw new ExchangeRefusal('not_found');
  if (userId === identity.userId) throw new ExchangeRefusal('herself');
  // Only a colleague her rights let her see: otherwise as if unknown.
  const card = await colleagueCard(db, identity, userId);
  if (!card) throw new ExchangeRefusal('not_found');
  return { userId, name: card.name };
}

/**
 * Her assistant asks a colleague's. Answered alone when the colleague allowed the subject;
 * otherwise passed to the colleague — a thing to do in her « À faire », and she is told.
 */
export async function ask(
  db: SqlExecutor,
  identity: Asker,
  input: { colleague: string; subject: Exchange['subject']; question: string },
  now = new Date(),
): Promise<Exchange> {
  const to = await colleagueOf(db, identity, input.colleague);
  const { rows: today } = await db.query<{ count: string }>(
    `select count(*) from assistant_exchanges
      where from_user_id = $1 and created_at > now() - interval '1 day'`,
    [identity.userId],
  );
  if (Number(today[0]?.count ?? 0) >= MAX_ASKED_PER_DAY) throw new ExchangeRefusal('too_many');
  const alone =
    input.subject !== 'other' && (await allowedSubjects(db, to.userId)).includes(input.subject)
      ? await answerAlone(db, to.userId, input.subject, now)
      : null;
  const exchangeId = newId('exc');
  const { rows } = await db.query<Row>(
    `insert into assistant_exchanges (exchange_id, organization_id, from_user_id, from_name,
       to_user_id, to_name, subject, question, status, answer, answered_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [
      exchangeId,
      identity.organizationId,
      identity.userId,
      identity.name || identity.userId,
      to.userId,
      to.name,
      input.subject,
      input.question,
      alone ? 'answered' : 'waiting',
      alone?.text ?? null,
      alone ? now : null,
    ],
  );
  if (!alone) {
    const title = notificationWords().exchangeAsked(
      identity.name || identity.userId,
      input.question,
    );
    if (env.publicWebUrl) {
      await putTask(db, identity.organizationId, to.userId, {
        source: 'exchanges',
        key: exchangeId,
        title: title.slice(0, 300),
        href: `${env.publicWebUrl}/assistant/echanges`,
      });
    }
    await tell(db, identity.organizationId, to.userId, {
      kind: 'exchange.asked',
      title,
      href: '/assistant/echanges',
    });
  }
  return exchangeOf(rows[0] as Row);
}

/** The colleague answers what was passed to her, or declines; the asker is told. */
async function settle(
  db: SqlExecutor,
  identity: Asker,
  exchangeId: string,
  answer: string | null,
): Promise<Exchange | null> {
  const { rows } = await db.query<Row>(
    `update assistant_exchanges set status = $3, answer = $4, answered_at = now()
      where exchange_id = $1 and to_user_id = $2 and status = 'waiting' returning *`,
    [exchangeId, identity.userId, answer === null ? 'declined' : 'replied', answer],
  );
  const row = rows[0];
  if (!row) return null;
  await closeTask(db, identity.userId, { source: 'exchanges', key: exchangeId });
  await tell(db, identity.organizationId, row.from_user_id, {
    kind: 'exchange.replied',
    title:
      answer === null
        ? notificationWords().exchangeDeclined(row.to_name)
        : notificationWords().exchangeReplied(row.to_name),
    href: '/assistant/echanges',
  });
  return exchangeOf(row);
}

/** The asker takes back what still waits: it leaves the colleague's « À faire ». */
async function withdraw(db: SqlExecutor, userId: string, exchangeId: string): Promise<boolean> {
  const { rows } = await db.query<Row>(
    `update assistant_exchanges set status = 'withdrawn', answered_at = now()
      where exchange_id = $1 and from_user_id = $2 and status = 'waiting' returning *`,
    [exchangeId, userId],
  );
  const row = rows[0];
  if (!row) return false;
  await closeTask(db, row.to_user_id, { source: 'exchanges', key: exchangeId });
  return true;
}

const askInput = z.object({
  colleague: z
    .string()
    .min(2)
    .max(128)
    .describe('Le collègue : son nom tel qu’elle l’a écrit, ou son identifiant de compte.'),
  subject: z
    .enum(asked)
    .describe(
      'availability : ses moments pris dans les 7 jours ; workload : combien de choses l’attendent ; other : toute autre question, qui lui sera transmise.',
    ),
  question: z
    .string()
    .min(3)
    .max(1000)
    .describe('La question, en une phrase claire, telle que le collègue la lira.'),
});

/**
 * The chat's tool (level 2): her assistant asks a colleague's. It answers alone on what the
 * colleague allowed; otherwise the question waits for the colleague, and can be taken back.
 */
export function colleagueTool(identity: Asker): CapabilityTool {
  return {
    name: 'ask_colleague_assistant',
    description:
      'Pose une question à l’assistant d’un collègue : ses disponibilités (availability), sa charge (workload) ou autre chose (other). Son assistant répond seul si elle l’a permis ; sinon la question lui est transmise et elle répondra plus tard. Dis toujours à la personne lequel des deux s’est produit, et ne déduis rien au-delà de la réponse.',
    input: askInput,
    jsonSchema: z.toJSONSchema(askInput) as Record<string, unknown>,
    autonomy: 2,
    async execute(input) {
      const parsed = askInput.safeParse(input);
      if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
      try {
        const exchange = await transaction(identity.organizationId, (db) =>
          ask(db, identity, parsed.data),
        );
        return {
          status: 'done',
          output:
            exchange.status === 'answered'
              ? {
                  answeredBy: 'her_assistant',
                  colleague: exchange.to.name,
                  answer: exchange.answer,
                }
              : {
                  answeredBy: 'nobody_yet',
                  colleague: exchange.to.name,
                  passedToHer: true,
                  note: 'Elle n’a pas permis à son assistant de répondre seul à cela : la question l’attend dans son « À faire ». Sa réponse arrivera dans « Entre assistants », sur la page de l’assistant.',
                },
        };
      } catch (error) {
        if (error instanceof ExchangeRefusal) {
          return {
            status: 'refused',
            reason: error.reason === 'too_many' ? 'not_allowed' : 'invalid_input',
          };
        }
        throw error;
      }
    },
  };
}

type Ctx = Context<{ Variables: IdentityVariables }>;

function herself(c: Ctx): void {
  if (c.get('viewedBy')) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only the person settles her exchanges.');
  }
}

/** Exchanges between assistants, under /v1/exchanges. */
export const exchangeRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        allowed: await allowedSubjects(db, userId),
        ...(await exchangesOf(db, userId)),
      })),
    );
  })
  // What her assistant may answer alone: nothing until she says so.
  .post('/settings', async (c) => {
    herself(c);
    const parsed = z
      .object({ allowed: z.array(z.enum(subjects)).max(subjects.length) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Known subjects.');
    const identity = c.get('identity');
    const allowed = subjects.filter((subject) => parsed.data.allowed.includes(subject));
    await transaction(identity.organizationId, (db) => allow(db, identity, allowed));
    return c.json({ allowed });
  })
  .post('/:exchangeId/reply', async (c) => {
    herself(c);
    const parsed = z
      .object({ answer: z.string().trim().min(1).max(2000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'An answer.');
    const identity = c.get('identity');
    const exchange = await transaction(identity.organizationId, (db) =>
      settle(db, identity, c.req.param('exchangeId'), parsed.data.answer),
    );
    if (!exchange) throw new GestureRefusal(404, 'not_found', 'Nothing waits for her there.');
    return c.json({ exchange });
  })
  .post('/:exchangeId/decline', async (c) => {
    herself(c);
    const identity = c.get('identity');
    const exchange = await transaction(identity.organizationId, (db) =>
      settle(db, identity, c.req.param('exchangeId'), null),
    );
    if (!exchange) throw new GestureRefusal(404, 'not_found', 'Nothing waits for her there.');
    return c.json({ exchange });
  })
  .post('/:exchangeId/withdraw', async (c) => {
    herself(c);
    const { organizationId, userId } = c.get('identity');
    const done = await transaction(organizationId, (db) =>
      withdraw(db, userId, c.req.param('exchangeId')),
    );
    if (!done) throw new GestureRefusal(404, 'not_found', 'Nothing of hers waits there.');
    return c.json({ withdrawn: true });
  });
