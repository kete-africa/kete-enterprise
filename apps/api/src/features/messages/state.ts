import type { Thread } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { filesOf, type ThreadFile } from '@kete/threads';
import { phoneKey } from '../parties/index.js';

// What a thread shows beside its words (spec 098, FR-002, FR-007, FR-009, FR-011): names — never an
// identifier —, the holdings on its object, the cards waiting for a decision, the actions asked in
// it, its object's dated facts, its files and their versions, what was done lately, and where its
// object opens.

export interface ThreadHolding {
  holdingId: string;
  what: string;
  holder: { kind: 'person' | 'agent'; id: string };
  state: string;
  since: string;
  due: string | null;
  priority: string;
  sourceKind: string;
  sourceRef: string;
  href: string | null;
}

/** The sources whose holdings are decisions: a step of a circuit, a request, a draft (FR-011). */
const DECISIONS = ['circuit_step', 'request', 'draft', 'outside'];

type HoldingRow = {
  holding_id: string;
  what: string;
  holder_kind: 'person' | 'agent';
  holder_id: string;
  state: string;
  since: Date;
  waiting_since: Date | null;
  due: string | null;
  priority: string;
  source_kind: string;
  source_ref: string;
  href: string | null;
};
const holdingOf = (r: HoldingRow): ThreadHolding => ({
  holdingId: r.holding_id,
  what: r.what,
  holder: { kind: r.holder_kind, id: r.holder_id },
  state: r.state,
  since: (r.waiting_since ?? r.since).toISOString(),
  due: r.due,
  priority: r.priority,
  sourceKind: r.source_kind,
  sourceRef: r.source_ref,
  href: r.href,
});
const COLUMNS = `holding_id, what, holder_kind, holder_id, state, since, waiting_since,
  to_char(due, 'YYYY-MM-DD') as due, priority, source_kind, source_ref, href`;

/** The open holdings on an object, the oldest wait first. */
export async function holdingsOn(
  db: SqlExecutor,
  object: { kind: string; id: string },
): Promise<ThreadHolding[]> {
  const { rows } = await db.query<HoldingRow>(
    `select ${COLUMNS} from kete_holdings
      where object_kind = $1 and object_id = $2 and state <> 'done'
      order by coalesce(waiting_since, since)`,
    [object.kind, object.id],
  );
  return rows.map(holdingOf);
}

/** The holdings the messages for action of a thread made, open or done, by message. */
export async function actionsOf(db: SqlExecutor, threadId: string) {
  const { rows } = await db.query<HoldingRow & { done_at: Date | null }>(
    `select ${COLUMNS}, done_at from kete_holdings
      where source_app = 'threads' and source_kind = 'message'
        and source_ref in (select message_id from kete_messages where thread_id = $1)`,
    [threadId],
  );
  return Object.fromEntries(
    rows.map((r) => [
      r.source_ref,
      { ...holdingOf(r), doneAt: r.done_at ? new Date(r.done_at).toISOString() : null },
    ]),
  );
}

/** What was finished on the object lately: the last ten. */
async function doneLately(db: SqlExecutor, object: { kind: string; id: string }) {
  const { rows } = await db.query<{ what: string; holder_id: string; done_at: Date }>(
    `select what, holder_id, done_at from kete_holdings
      where object_kind = $1 and object_id = $2 and state = 'done'
      order by done_at desc limit 10`,
    [object.kind, object.id],
  );
  return rows.map((r) => ({
    what: r.what,
    holder: r.holder_id,
    at: new Date(r.done_at).toISOString(),
  }));
}

/** The dated facts the apps said on the object: its deadlines, meetings, visits (Planifier). */
async function datesOn(db: SqlExecutor, object: { kind: string; id: string }) {
  if (object.kind !== 'project' && object.kind !== 'party') return [];
  const column = object.kind === 'project' ? 'project_id' : 'party_id';
  const { rows } = await db.query<{ label: string; day: string | null; starts_at: Date | null }>(
    `select label, to_char(day, 'YYYY-MM-DD') as day, starts_at from time_facts
      where ${column} = $1 and visibility <> 'private'
        and coalesce(day, starts_at::date) >= current_date - 1
      order by coalesce(day, starts_at::date) limit 8`,
    [object.id],
  );
  return rows.map((r) => ({
    label: r.label,
    at: r.day ?? (r.starts_at ? new Date(r.starts_at).toISOString() : null),
  }));
}

/** Where the object opens: its page in the center, or its app's own address. */
async function objectLink(db: SqlExecutor, thread: Thread): Promise<string | null> {
  const object = thread.object;
  if (!object) return null;
  if (object.kind === 'project') return `/projets/${object.id}`;
  if (object.kind === 'party') return `/tiers/${object.id}`;
  const { rows } = await db.query<{ href: string | null }>(
    `select href from thread_objects where thread_id = $1`,
    [thread.id],
  );
  return rows[0]?.href ?? null;
}

/** The files of a thread, each name with its versions, the latest first. */
export function filesByName(files: ThreadFile[]) {
  const byName = new Map<string, ThreadFile[]>();
  for (const file of files) {
    const key = file.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), file]);
  }
  return [...byName.values()].map((versions) => ({
    name: versions[0]?.name ?? '',
    versions: versions.map((f) => ({
      id: f.id,
      version: f.version,
      bytes: f.bytes,
      mediaType: f.media_type,
      by: f.by.id,
      at: f.at,
    })),
  }));
}

/** The state beside a thread (FR-009) and its cards (FR-011). */
export async function stateOf(db: SqlExecutor, thread: Thread) {
  const holdings = thread.object ? await holdingsOn(db, thread.object) : [];
  return {
    holdings: holdings.filter((h) => !DECISIONS.includes(h.sourceKind)),
    cards: holdings.filter((h) => DECISIONS.includes(h.sourceKind)),
    done: thread.object ? await doneLately(db, thread.object) : [],
    dates: thread.object ? await datesOn(db, thread.object) : [],
    files: filesByName(await filesOf(db, thread.id)),
    link: await objectLink(db, thread),
  };
}

/**
 * The names a thread shows (FR-002): people from the structure, agents by theirs, a contact by her
 * third party, else her address; who signs in, by her account's name; anyone else is someone
 * outside the organization — never an identifier.
 */
/** The faces of the agents a thread shows (spec 107, R6): those that have one of their own. */
export async function facesOf(
  db: SqlExecutor,
  ids: string[],
): Promise<Record<string, { glyph: string; tint?: string }>> {
  const { rows } = await db.query<{ agent_id: string; face: { glyph: string; tint?: string } }>(
    `select agent_id, face from agents where agent_id = any($1) and face is not null`,
    [[...new Set(ids)]],
  );
  return Object.fromEntries(rows.map((r) => [r.agent_id, r.face]));
}

export async function namesOf(
  db: SqlExecutor,
  ids: string[],
  signedIn: { userId: string; name: string },
  /** The word for a member known by her account only, not yet in the structure. */
  teammate: string,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  const { rows } = await db.query<{ id: string; name: string }>(
    `select account_user_id as id, name from people where account_user_id = any($1)
     union
     select agent_id as id, name from agents where agent_id = any($1)`,
    [unique],
  );
  const names: Record<string, string> = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  for (const id of unique) {
    if (names[id]) continue;
    if (id === signedIn.userId) {
      names[id] = signedIn.name;
      continue;
    }
    // Kete's own agents — the assistant, the briefing, a copilot — are « Kete ».
    if (id.startsWith('agt_')) {
      names[id] = 'Kete';
      continue;
    }
    const at = id.indexOf(':');
    if (at <= 0) {
      names[id] = teammate;
      continue;
    }
    // A contact through its channel: the third party the center knows by it, else its address.
    const key = id.slice(at + 1);
    const { rows: party } = await db.query<{ name: string }>(
      `select name from parties
        where status = 'active'
          and (($1::text is not null and phone_key = $1) or lower(email) = lower($2))
        order by party_id limit 1`,
      [id.startsWith('mail:') ? null : phoneKey(key), key],
    );
    names[id] = party[0]?.name ?? key;
  }
  return names;
}
