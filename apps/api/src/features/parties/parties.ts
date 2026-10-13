import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// Third parties (spec 073, doctrine D-047): the companies and people outside the organization it
// works with. One record each — the same company may be a client, a supplier and a funder — held
// by the center and cited by every app by its identifier. An app says what it knows of a third
// party (a quote waiting, a contract, a ticket); the center gathers it. Duplicates are proposed,
// and merged by a person: whoever cites the merged record is led to the one that stays.

export function partiesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.parties (
  organization_id text not null,
  party_id text not null,
  kind text not null check (kind in ('company', 'person')),
  name text not null check (length(name) between 1 and 200),
  -- What it is to the organization: several at once.
  roles text[] not null default '{}'
    check (roles <@ array['client', 'supplier', 'funder', 'partner']::text[]),
  email text check (length(email) <= 320),
  phone text check (length(phone) <= 40),
  address text check (length(address) <= 400),
  -- Its registration with the tax office or the trade register, as it writes it.
  registration text check (length(registration) <= 80),
  channel text check (channel in ('whatsapp', 'telegram', 'email', 'phone')),
  -- What duplicates are found by: the name without case, accents nor legal form; the phone's digits.
  name_key text not null,
  phone_key text,
  status text not null default 'active' check (status in ('active', 'merged')),
  merged_into text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, party_id),
  check ((status = 'merged') = (merged_into is not null))
);
create index parties_name on ${s}.parties (organization_id, name_key) where status = 'active';
${policy('parties')}
grant select, insert, update on ${s}.parties to ${options.appRole};

-- Two records a person said are not the same: never proposed again.
create table ${s}.party_distinct (
  organization_id text not null,
  party_a text not null,
  party_b text not null,
  primary key (organization_id, party_a, party_b),
  check (party_a < party_b)
);
${policy('party_distinct')}
grant select, insert on ${s}.party_distinct to ${options.appRole};

-- What an app knows of a third party: one line per app and key, replaced when it changes.
create table ${s}.party_facts (
  organization_id text not null,
  party_id text not null,
  source text not null check (length(source) between 1 and 80),
  key text not null check (length(key) between 1 and 200),
  label text not null check (length(label) between 1 and 300),
  state text check (length(state) <= 120),
  href text check (length(href) <= 600),
  updated_at timestamptz not null default now(),
  primary key (organization_id, party_id, source, key),
  foreign key (organization_id, party_id) references ${s}.parties (organization_id, party_id)
);
${policy('party_facts')}
grant select, insert, update, delete on ${s}.party_facts to ${options.appRole};
`;
}

export const partyRoles = ['client', 'supplier', 'funder', 'partner'] as const;
export type PartyRole = (typeof partyRoles)[number];

export interface Party {
  partyId: string;
  kind: 'company' | 'person';
  name: string;
  roles: PartyRole[];
  email: string | null;
  phone: string | null;
  address: string | null;
  registration: string | null;
  channel: 'whatsapp' | 'telegram' | 'email' | 'phone' | null;
  /** The records merged into this one: whoever cites one of them is led here. */
  mergedFrom: string[];
}

export interface PartyFact {
  source: string;
  key: string;
  label: string;
  state: string | null;
  href: string | null;
  updatedAt: string;
}

type Row = {
  party_id: string;
  kind: Party['kind'];
  name: string;
  roles: PartyRole[];
  email: string | null;
  phone: string | null;
  address: string | null;
  registration: string | null;
  channel: Party['channel'];
  status: 'active' | 'merged';
  merged_into: string | null;
};
const COLUMNS = `party_id, kind, name, roles, email, phone, address, registration, channel, status,
  merged_into`;

const LEGAL_FORMS =
  /\b(sarl|sarlu|sa|sas|sasu|suarl|ets|etablissements?|ste|societe|gie|ong|ltd|inc)\b/g;

/** A name as duplicates are compared: no case, no accent, no legal form, no punctuation. */
export function nameKey(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // « S.A.R.L. » is « sarl »: an acronym's dots go before the rest of the punctuation.
      .replace(/\b(?:[a-z]\.){2,}/g, (acronym) => acronym.replaceAll('.', ''))
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(LEGAL_FORMS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** A phone as duplicates are compared: its last eight digits, whatever the prefix written. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D+/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

async function mergedInto(db: SqlExecutor, partyId: string): Promise<string[]> {
  const { rows } = await db.query<{ party_id: string }>(
    `select party_id from parties where merged_into = $1 order by party_id`,
    [partyId],
  );
  return rows.map((row) => row.party_id);
}

async function partyOf(db: SqlExecutor, row: Row): Promise<Party> {
  return {
    partyId: row.party_id,
    kind: row.kind,
    name: row.name,
    roles: row.roles,
    email: row.email,
    phone: row.phone,
    address: row.address,
    registration: row.registration,
    channel: row.channel,
    mergedFrom: await mergedInto(db, row.party_id),
  };
}

/**
 * A third party by its identifier. A merged record leads to the one that stays: an app that kept
 * the old identifier still finds its third party, and learns the new one.
 */
export async function findParty(db: SqlExecutor, partyId: string): Promise<Party | null> {
  let wanted = partyId;
  // A record merged into one that was merged later: follow, a few steps at most.
  for (let step = 0; step < 5; step += 1) {
    const { rows } = await db.query<Row>(`select ${COLUMNS} from parties where party_id = $1`, [
      wanted,
    ]);
    const row = rows[0];
    if (!row) return null;
    if (row.status === 'active') return partyOf(db, row);
    wanted = row.merged_into ?? '';
  }
  return null;
}

/** The third parties, by name; a search reads the name without case nor accent, and the phone. */
export async function listParties(
  db: SqlExecutor,
  filter: { q?: string | undefined; role?: PartyRole | undefined } = {},
): Promise<Party[]> {
  const q = filter.q?.trim() ?? '';
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from parties
      where status = 'active'
        and ($1 = '' or name_key like '%' || $1 || '%' or ($2::text is not null and phone_key = $2))
        and ($3::text is null or $3 = any(roles))
      -- By the name as it is compared, then by age: the same order whatever the collation.
      order by name_key, party_id limit 200`,
    [nameKey(q), phoneKey(q), filter.role ?? null],
  );
  return Promise.all(rows.map((row) => partyOf(db, row)));
}

export async function factsOf(db: SqlExecutor, partyId: string): Promise<PartyFact[]> {
  const { rows } = await db.query<{
    source: string;
    key: string;
    label: string;
    state: string | null;
    href: string | null;
    updated_at: Date;
  }>(
    `select source, key, label, state, href, updated_at from party_facts
      where party_id = $1 order by source, updated_at desc`,
    [partyId],
  );
  return rows.map((row) => ({
    source: row.source,
    key: row.key,
    label: row.label,
    state: row.state,
    href: row.href,
    updatedAt: row.updated_at.toISOString(),
  }));
}

/** A rule of the third parties was not met: the change is refused, nothing is written. */
export class PartyError extends Error {
  constructor(
    readonly code: 'not_found' | 'same_party' | 'already_merged',
    message: string,
  ) {
    super(message);
    this.name = 'PartyError';
  }
}

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  text(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const partyInput = z.object({
  kind: z.enum(['company', 'person']).default('company'),
  name: text(200).min(1),
  roles: z.array(z.enum(partyRoles)).max(4).default([]),
  email: z
    .union([z.email().max(320), z.literal('')])
    .nullable()
    .optional(),
  phone: optional(40),
  address: optional(400),
  registration: optional(80),
  channel: z.enum(['whatsapp', 'telegram', 'email', 'phone']).nullable().optional(),
});

export const createParty = defineCommand({
  name: 'create-party',
  input: partyInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const { rows } = await db.query<Row>(
      `insert into parties (organization_id, party_id, kind, name, roles, email, phone, address,
         registration, channel, name_key, phone_key, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning ${COLUMNS}`,
      [
        organizationId,
        newId('pty'),
        input.kind,
        input.name,
        [...new Set(input.roles)].sort(),
        input.email || null,
        input.phone ?? null,
        input.address ?? null,
        input.registration ?? null,
        input.channel ?? null,
        nameKey(input.name),
        phoneKey(input.phone),
        actor.onBehalfOf?.id ?? actor.id,
      ],
    );
    return partyOf(db, rows[0] as Row);
  },
  summarize: (input) => `Third party: ${input.name}`,
});

export const updatePartyInput = partyInput.partial().extend({
  partyId: z.string().regex(/^pty_[0-9a-f-]{8,64}$/),
});

export const updateParty = defineCommand({
  name: 'update-party',
  input: updatePartyInput,
  reversibility: { reversible: true, inverse: 'update-party' },
  async handler(input, { db }) {
    const before = await findParty(db, input.partyId);
    if (!before) throw new PartyError('not_found', 'No such third party here.');
    const next = {
      kind: input.kind ?? before.kind,
      name: input.name ?? before.name,
      roles: input.roles ? [...new Set(input.roles)].sort() : before.roles,
      email: input.email === undefined ? before.email : input.email || null,
      phone: input.phone === undefined ? before.phone : input.phone,
      address: input.address === undefined ? before.address : input.address,
      registration: input.registration === undefined ? before.registration : input.registration,
      channel: input.channel === undefined ? before.channel : input.channel,
    };
    await db.query(
      `update parties set kind = $2, name = $3, roles = $4, email = $5, phone = $6, address = $7,
         registration = $8, channel = $9, name_key = $10, phone_key = $11, updated_at = now()
        where party_id = $1`,
      [
        before.partyId,
        next.kind,
        next.name,
        next.roles,
        next.email,
        next.phone,
        next.address,
        next.registration,
        next.channel,
        nameKey(next.name),
        phoneKey(next.phone),
      ],
    );
    return { before, party: (await findParty(db, before.partyId)) as Party };
  },
  summarize: (_input, output) => `Third party updated: ${output.party.name}`,
});

export interface Duplicate {
  a: { partyId: string; name: string };
  b: { partyId: string; name: string };
  /** What makes them look alike. */
  because: ('name' | 'phone' | 'email')[];
}

/**
 * The records that look like one third party: the same name once case, accents and legal form are
 * gone, the same phone, or the same e-mail. Pairs a person said are distinct are left out.
 */
export async function duplicates(db: SqlExecutor): Promise<Duplicate[]> {
  const { rows } = await db.query<{
    a_id: string;
    a_name: string;
    b_id: string;
    b_name: string;
    same_name: boolean;
    same_phone: boolean;
    same_email: boolean;
  }>(
    `select a.party_id as a_id, a.name as a_name, b.party_id as b_id, b.name as b_name,
            (a.name_key <> '' and a.name_key = b.name_key) as same_name,
            (a.phone_key is not null and a.phone_key = b.phone_key) as same_phone,
            (a.email is not null and lower(a.email) = lower(b.email)) as same_email
       from parties a join parties b
         on a.organization_id = b.organization_id and a.party_id < b.party_id
      where a.status = 'active' and b.status = 'active'
        and ((a.name_key <> '' and a.name_key = b.name_key)
          or (a.phone_key is not null and a.phone_key = b.phone_key)
          or (a.email is not null and lower(a.email) = lower(b.email)))
        and not exists (select 1 from party_distinct d
                         where d.party_a = a.party_id and d.party_b = b.party_id)
      order by a.name_key, a.party_id limit 50`,
  );
  return rows.map((row) => ({
    a: { partyId: row.a_id, name: row.a_name },
    b: { partyId: row.b_id, name: row.b_name },
    because: [
      ...(row.same_name ? (['name'] as const) : []),
      ...(row.same_phone ? (['phone'] as const) : []),
      ...(row.same_email ? (['email'] as const) : []),
    ],
  }));
}

const pairInput = z.object({
  keep: z.string().regex(/^pty_[0-9a-f-]{8,64}$/),
  merge: z.string().regex(/^pty_[0-9a-f-]{8,64}$/),
});

/**
 * Two records are one third party: one stays, with the roles of both and what the other alone
 * knew; the other leads to it; what the apps said of either is kept on the one that stays.
 */
export const mergeParties = defineCommand({
  name: 'merge-parties',
  input: pairInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    if (input.keep === input.merge) throw new PartyError('same_party', 'Two different records.');
    const { rows } = await db.query<Row>(
      `select ${COLUMNS} from parties where party_id = any($1) for update`,
      [[input.keep, input.merge]],
    );
    const keep = rows.find((row) => row.party_id === input.keep);
    const gone = rows.find((row) => row.party_id === input.merge);
    if (!keep || !gone) throw new PartyError('not_found', 'No such third party here.');
    if (keep.status !== 'active' || gone.status !== 'active') {
      throw new PartyError('already_merged', 'One of them was already merged.');
    }
    const phone = keep.phone ?? gone.phone;
    await db.query(
      `update parties set roles = $2, email = $3, phone = $4, address = $5, registration = $6,
         channel = $7, phone_key = $8, updated_at = now() where party_id = $1`,
      [
        keep.party_id,
        [...new Set([...keep.roles, ...gone.roles])].sort(),
        keep.email ?? gone.email,
        phone,
        keep.address ?? gone.address,
        keep.registration ?? gone.registration,
        keep.channel ?? gone.channel,
        phoneKey(phone),
      ],
    );
    // What the apps said of the one that goes: kept, unless the one that stays already says it.
    await db.query(
      `insert into party_facts (organization_id, party_id, source, key, label, state, href, updated_at)
       select organization_id, $1, source, key, label, state, href, updated_at
         from party_facts where party_id = $2
       on conflict (organization_id, party_id, source, key) do nothing`,
      [keep.party_id, gone.party_id],
    );
    await db.query('delete from party_facts where party_id = $1', [gone.party_id]);
    // Records merged earlier into the one that goes now lead to the one that stays.
    await db.query(
      `update parties set status = 'merged', merged_into = $1, updated_at = now()
        where party_id = $2 or merged_into = $2`,
      [keep.party_id, gone.party_id],
    );
    return { party: (await findParty(db, keep.party_id)) as Party, merged: gone.party_id };
  },
  summarize: (_input, output) => `Third parties merged into ${output.party.name}`,
});

/** Two records are not the same third party: the pair is not proposed again. */
export const keepDistinct = defineCommand({
  name: 'keep-parties-distinct',
  input: pairInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    if (input.keep === input.merge) throw new PartyError('same_party', 'Two different records.');
    const [a, b] = [input.keep, input.merge].sort() as [string, string];
    await db.query(
      `insert into party_distinct (organization_id, party_a, party_b) values ($1, $2, $3)
       on conflict do nothing`,
      [organizationId, a, b],
    );
    return { a, b };
  },
  summarize: () => 'Two third parties kept distinct',
});

export const factInput = z.object({
  /** The app that says it: its name, as « À faire » shows a task's origin. */
  source: text(80).min(1),
  key: text(200).min(1),
  label: text(300).min(1),
  state: optional(120),
  href: z
    .union([
      z.url().max(600),
      z
        .string()
        .regex(/^\/[^\s]*$/)
        .max(600),
    ])
    .nullable()
    .optional(),
});

/** An app says what it knows of a third party — or takes it back with `gone`. */
export async function putFact(
  db: SqlExecutor,
  organizationId: string,
  partyId: string,
  fact: z.output<typeof factInput>,
): Promise<void> {
  await db.query(
    `insert into party_facts (organization_id, party_id, source, key, label, state, href)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, party_id, source, key) do update
       set label = excluded.label, state = excluded.state, href = excluded.href, updated_at = now()`,
    [
      organizationId,
      partyId,
      fact.source,
      fact.key,
      fact.label,
      fact.state ?? null,
      fact.href ?? null,
    ],
  );
}

export async function dropFact(
  db: SqlExecutor,
  partyId: string,
  fact: { source: string; key: string },
): Promise<boolean> {
  const { rows } = await db.query(
    'delete from party_facts where party_id = $1 and source = $2 and key = $3 returning key',
    [partyId, fact.source, fact.key],
  );
  return rows.length > 0;
}
