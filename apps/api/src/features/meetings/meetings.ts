import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { openAction, readRegister } from '../actions/index.js';

/**
 * Meetings and decision notes (spec 013), with row-level security in the same migration. A meeting
 * starts from the gaps — red indicators, overdue actions — and ends with dated actions; its record
 * is on time or late against its type's delay.
 */
export function meetingsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.meeting_types (
  type_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 160),
  kind text not null check (kind in ('decision', 'operations', 'quality', 'information', 'innovation')),
  cadence text not null default '',
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 600),
  chair_position_id text,
  secretary_position_id text,
  member_position_ids text[] not null default '{}',
  quorum integer check (quorum >= 1),
  record_within_hours integer not null default 48 check (record_within_hours between 1 and 720),
  created_at timestamptz not null default now(),
  unique (organization_id, type_id),
  unique (organization_id, name),
  foreign key (organization_id, chair_position_id) references ${s}.positions (organization_id, position_id),
  foreign key (organization_id, secretary_position_id) references ${s}.positions (organization_id, position_id)
);
${policy('meeting_types')}

create table ${s}.meetings (
  meeting_id text primary key,
  organization_id text not null,
  type_id text not null,
  title text not null,
  starts_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'held', 'recorded')),
  agenda jsonb not null default '[]',
  present_person_ids text[] not null default '{}',
  quorum_met boolean,
  notes text,
  held_at timestamptz,
  record_due_at timestamptz,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, meeting_id),
  foreign key (organization_id, type_id) references ${s}.meeting_types (organization_id, type_id)
);
create index meetings_starts on ${s}.meetings (organization_id, starts_at);
${policy('meetings')}

create table ${s}.meeting_decisions (
  decision_id text primary key,
  organization_id text not null,
  meeting_id text not null,
  text text not null check (length(text) between 1 and 2000),
  responsible_person_id text,
  due_on date,
  action_id text,
  idea boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (organization_id, meeting_id) references ${s}.meetings (organization_id, meeting_id),
  foreign key (organization_id, responsible_person_id)
    references ${s}.people (organization_id, person_id)
);
${policy('meeting_decisions')}

create table ${s}.decision_notes (
  note_id text primary key,
  organization_id text not null,
  number text,
  year integer,
  seq integer,
  subject text not null check (length(subject) between 1 and 300),
  body text not null,
  signed_by_person_id text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_on date,
  created_at timestamptz not null default now(),
  unique (organization_id, note_id),
  unique (organization_id, number),
  unique (organization_id, year, seq),
  foreign key (organization_id, signed_by_person_id)
    references ${s}.people (organization_id, person_id)
);
${policy('decision_notes')}

create table ${s}.note_reads (
  organization_id text not null,
  note_id text not null,
  person_id text not null,
  read_at timestamptz not null default now(),
  primary key (note_id, person_id),
  foreign key (organization_id, note_id) references ${s}.decision_notes (organization_id, note_id),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id)
);
${policy('note_reads')}

grant select, insert, update on ${s}.meeting_types, ${s}.meetings, ${s}.meeting_decisions,
  ${s}.decision_notes, ${s}.note_reads to ${options.appRole};
`;
}

export interface AgendaItem {
  key: string;
  title: string;
  kind: 'red_indicators' | 'overdue_action' | 'manual';
  detail: string | null;
}

export interface MeetingType {
  typeId: string;
  name: string;
  kind: 'decision' | 'operations' | 'quality' | 'information' | 'innovation';
  cadence: string;
  durationMinutes: number;
  chairPositionId: string | null;
  secretaryPositionId: string | null;
  memberPositionIds: string[];
  quorum: number | null;
  recordWithinHours: number;
}

export interface Meeting {
  meetingId: string;
  typeId: string;
  typeName: string;
  kind: MeetingType['kind'];
  title: string;
  startsAt: string;
  status: 'planned' | 'held' | 'recorded';
  agenda: AgendaItem[];
  presentPersonIds: string[];
  quorumMet: boolean | null;
  notes: string | null;
  recordDueAt: string | null;
  recordedAt: string | null;
  onTime: boolean | null;
  decisions: {
    decisionId: string;
    text: string;
    responsiblePersonId: string | null;
    responsibleName: string | null;
    dueOn: string | null;
    actionId: string | null;
    idea: boolean;
  }[];
}

export interface DecisionNote {
  noteId: string;
  number: string | null;
  subject: string;
  body: string;
  signedByPersonId: string;
  signedByName: string;
  status: 'draft' | 'published';
  publishedOn: string | null;
  reads: number;
  readByMe: boolean;
}

export async function listTypes(db: SqlExecutor): Promise<MeetingType[]> {
  const { rows } = await db.query<{
    type_id: string;
    name: string;
    kind: MeetingType['kind'];
    cadence: string;
    duration_minutes: number;
    chair_position_id: string | null;
    secretary_position_id: string | null;
    member_position_ids: string[];
    quorum: number | null;
    record_within_hours: number;
  }>(`select type_id, name, kind, cadence, duration_minutes, chair_position_id,
        secretary_position_id, member_position_ids, quorum, record_within_hours
        from meeting_types order by name`);
  return rows.map((r) => ({
    typeId: r.type_id,
    name: r.name,
    kind: r.kind,
    cadence: r.cadence,
    durationMinutes: r.duration_minutes,
    chairPositionId: r.chair_position_id,
    secretaryPositionId: r.secretary_position_id,
    memberPositionIds: r.member_position_ids,
    quorum: r.quorum,
    recordWithinHours: r.record_within_hours,
  }));
}

export async function listMeetings(db: SqlExecutor, meetingId?: string): Promise<Meeting[]> {
  const { rows } = await db.query<{
    meeting_id: string;
    type_id: string;
    type_name: string;
    kind: MeetingType['kind'];
    title: string;
    starts_at: Date;
    status: Meeting['status'];
    agenda: AgendaItem[];
    present_person_ids: string[];
    quorum_met: boolean | null;
    notes: string | null;
    record_due_at: Date | null;
    recorded_at: Date | null;
  }>(
    `select m.meeting_id, m.type_id, t.name as type_name, t.kind, m.title, m.starts_at, m.status,
       m.agenda, m.present_person_ids, m.quorum_met, m.notes, m.record_due_at, m.recorded_at
       from meetings m join meeting_types t on t.type_id = m.type_id
      where ($1::text is null or m.meeting_id = $1)
      order by m.starts_at desc limit 200`,
    [meetingId ?? null],
  );
  const { rows: decisions } = await db.query<{
    decision_id: string;
    meeting_id: string;
    text: string;
    responsible_person_id: string | null;
    name: string | null;
    due_on: string | null;
    action_id: string | null;
    idea: boolean;
  }>(
    `select d.decision_id, d.meeting_id, d.text, d.responsible_person_id, pe.name,
       to_char(d.due_on, 'YYYY-MM-DD') as due_on, d.action_id, d.idea
       from meeting_decisions d left join people pe on pe.person_id = d.responsible_person_id
      where d.meeting_id = any($1::text[]) order by d.created_at`,
    [rows.map((r) => r.meeting_id)],
  );
  return rows.map((r) => ({
    meetingId: r.meeting_id,
    typeId: r.type_id,
    typeName: r.type_name,
    kind: r.kind,
    title: r.title,
    startsAt: r.starts_at.toISOString(),
    status: r.status,
    agenda: r.agenda,
    presentPersonIds: r.present_person_ids,
    quorumMet: r.quorum_met,
    notes: r.notes,
    recordDueAt: r.record_due_at?.toISOString() ?? null,
    recordedAt: r.recorded_at?.toISOString() ?? null,
    onTime:
      r.recorded_at && r.record_due_at
        ? r.recorded_at.getTime() <= r.record_due_at.getTime()
        : null,
    decisions: decisions
      .filter((d) => d.meeting_id === r.meeting_id)
      .map((d) => ({
        decisionId: d.decision_id,
        text: d.text,
        responsiblePersonId: d.responsible_person_id,
        responsibleName: d.name,
        dueOn: d.due_on,
        actionId: d.action_id,
        idea: d.idea,
      })),
  }));
}

export async function listNotes(db: SqlExecutor, personId: string | null): Promise<DecisionNote[]> {
  const { rows } = await db.query<{
    note_id: string;
    number: string | null;
    subject: string;
    body: string;
    signed_by_person_id: string;
    name: string;
    status: DecisionNote['status'];
    published_on: string | null;
    reads: string;
    read_by_me: boolean;
  }>(
    `select n.note_id, n.number, n.subject, n.body, n.signed_by_person_id, pe.name, n.status,
       to_char(n.published_on, 'YYYY-MM-DD') as published_on,
       (select count(*) from note_reads r where r.note_id = n.note_id) as reads,
       exists (select 1 from note_reads r where r.note_id = n.note_id and r.person_id = $1)
         as read_by_me
       from decision_notes n join people pe on pe.person_id = n.signed_by_person_id
      order by n.year desc nulls first, n.seq desc nulls first, n.created_at desc`,
    [personId],
  );
  return rows.map((r) => ({
    noteId: r.note_id,
    number: r.number,
    subject: r.subject,
    body: r.body,
    signedByPersonId: r.signed_by_person_id,
    signedByName: r.name,
    status: r.status,
    publishedOn: r.published_on,
    reads: Number(r.reads),
    readByMe: r.read_by_me,
  }));
}

/**
 * The gaps a meeting starts from (principle P5): the units with indicators in red in the last
 * measured quarter, and the actions past due.
 */
async function gapsAgenda(db: SqlExecutor): Promise<AgendaItem[]> {
  const { rows } = await db.query<{ unit: string; reds: string; people: string }>(
    `select u.name as unit, count(*) as reds, count(distinct r.person_id) as people
       from review_lines l
       join reviews r on r.review_id = l.review_id
       join units u on u.unit_id = r.unit_id
      where l.colour = 'red' and r.quarter_id = (
        select quarter_id from performance_quarters where status in ('measured', 'closed')
         order by ends_on desc limit 1)
      group by u.name order by count(*) desc limit 8`,
  );
  const overdue = (await readRegister(db, { openOnly: true })).filter((a) => a.overdue).slice(0, 8);
  return [
    ...rows.map((r) => ({
      key: newId('agi'),
      title: r.unit,
      kind: 'red_indicators' as const,
      detail: `${r.reds} / ${r.people}`,
    })),
    ...overdue.map((a) => ({
      key: newId('agi'),
      title: a.title,
      kind: 'overdue_action' as const,
      detail: `${a.responsibleName ?? ''} · ${a.dueOn}`,
    })),
  ];
}

export class MeetingRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'wrong_step' | 'duplicate',
    message: string,
  ) {
    super(message);
    this.name = 'MeetingRuleError';
  }
}

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function lockMeeting(db: SqlExecutor, meetingId: string) {
  const { rows } = await db.query<{ status: Meeting['status']; type_id: string }>(
    `select status, type_id from meetings where meeting_id = $1 for update`,
    [meetingId],
  );
  if (!rows[0]) throw new MeetingRuleError('not_found', 'No such meeting.');
  return rows[0];
}

export const defineMeetingType = defineCommand({
  name: 'define-meeting-type',
  input: z.object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(['decision', 'operations', 'quality', 'information', 'innovation']),
    cadence: z.string().trim().max(200).default(''),
    durationMinutes: z.number().int().min(5).max(600).default(60),
    chairPositionId: id('pos').optional(),
    secretaryPositionId: id('pos').optional(),
    memberPositionIds: z.array(id('pos')).max(60).default([]),
    quorum: z.number().int().min(1).max(60).optional(),
    recordWithinHours: z.number().int().min(1).max(720).default(48),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const typeId = newId('mtt');
    await db
      .query(
        `insert into meeting_types (type_id, organization_id, name, kind, cadence, duration_minutes,
           chair_position_id, secretary_position_id, member_position_ids, quorum,
           record_within_hours)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          typeId,
          organizationId,
          input.name,
          input.kind,
          input.cadence,
          input.durationMinutes,
          input.chairPositionId ?? null,
          input.secretaryPositionId ?? null,
          input.memberPositionIds,
          input.quorum ?? null,
          input.recordWithinHours,
        ],
      )
      .catch((error: { code?: string }) => {
        if (error.code === '23505') throw new MeetingRuleError('duplicate', 'That name exists.');
        if (error.code === '23503') throw new MeetingRuleError('not_found', 'No such position.');
        throw error;
      });
    return { typeId };
  },
  summarize: (input) => `Meeting type « ${input.name} » defined`,
});

export const planMeeting = defineCommand({
  name: 'plan-meeting',
  input: z.object({
    typeId: id('mtt'),
    title: z.string().trim().min(1).max(200).optional(),
    startsAt: z.iso.datetime({ offset: true }),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const type = (await listTypes(db)).find((t) => t.typeId === input.typeId);
    if (!type) throw new MeetingRuleError('not_found', 'No such meeting type.');
    const meetingId = newId('mtg');
    // Decisions meetings start from the gaps; the others from their own items.
    const agenda =
      type.kind === 'decision' || type.kind === 'operations' || type.kind === 'quality'
        ? await gapsAgenda(db)
        : [];
    await db.query(
      `insert into meetings (meeting_id, organization_id, type_id, title, starts_at, agenda)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        meetingId,
        organizationId,
        type.typeId,
        input.title ?? type.name,
        input.startsAt,
        JSON.stringify(agenda),
      ],
    );
    return { meetingId, agenda: agenda.length };
  },
  summarize: (input) => `Meeting planned (${input.typeId})`,
});

export const addAgendaItem = defineCommand({
  name: 'add-agenda-item',
  input: z.object({ meetingId: id('mtg'), title: z.string().trim().min(1).max(300) }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const meeting = await lockMeeting(db, input.meetingId);
    if (meeting.status === 'recorded') {
      throw new MeetingRuleError('wrong_step', 'The record is published.');
    }
    const item: AgendaItem = {
      key: newId('agi'),
      title: input.title,
      kind: 'manual',
      detail: null,
    };
    await db.query(`update meetings set agenda = agenda || $2::jsonb where meeting_id = $1`, [
      input.meetingId,
      JSON.stringify([item]),
    ]);
    return { meetingId: input.meetingId };
  },
  summarize: (input) => `Agenda item added to ${input.meetingId}`,
});

export const holdMeeting = defineCommand({
  name: 'hold-meeting',
  input: z.object({ meetingId: id('mtg'), presentPersonIds: z.array(id('prs')).max(200) }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const meeting = await lockMeeting(db, input.meetingId);
    if (meeting.status !== 'planned') {
      throw new MeetingRuleError('wrong_step', 'This meeting was already held.');
    }
    const type = (await listTypes(db)).find((t) => t.typeId === meeting.type_id);
    const quorumMet = type?.quorum ? input.presentPersonIds.length >= type.quorum : null;
    await db.query(
      `update meetings set status = 'held', present_person_ids = $2, quorum_met = $3,
         held_at = now(), record_due_at = now() + make_interval(hours => $4)
        where meeting_id = $1`,
      [input.meetingId, input.presentPersonIds, quorumMet, type?.recordWithinHours ?? 48],
    );
    return { meetingId: input.meetingId, quorumMet };
  },
  summarize: (input) => `Meeting ${input.meetingId} held`,
});

/** A decision, and — with an owner and a deadline — its action in the register. */
export const recordDecision = defineCommand({
  name: 'record-decision',
  input: z.object({
    meetingId: id('mtg'),
    text: z.string().trim().min(1).max(2000),
    responsiblePersonId: id('prs').optional(),
    dueOn: day.optional(),
    idea: z.boolean().default(false),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const meeting = await lockMeeting(db, input.meetingId);
    if (meeting.status !== 'held') {
      throw new MeetingRuleError('wrong_step', 'Decisions are recorded once the meeting is held.');
    }
    const actionId =
      input.responsiblePersonId && input.dueOn
        ? await openAction(db, organizationId, {
            title: input.text,
            source: 'meeting',
            sourceRef: input.meetingId,
            responsiblePersonId: input.responsiblePersonId,
            dueOn: input.dueOn,
          })
        : null;
    const decisionId = newId('mdc');
    await db.query(
      `insert into meeting_decisions (decision_id, organization_id, meeting_id, text,
         responsible_person_id, due_on, action_id, idea)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        decisionId,
        organizationId,
        input.meetingId,
        input.text,
        input.responsiblePersonId ?? null,
        input.dueOn ?? null,
        actionId,
        input.idea,
      ],
    );
    return { decisionId, actionId };
  },
  summarize: (input) => `Decision recorded in ${input.meetingId}`,
});

export const publishRecord = defineCommand({
  name: 'publish-record',
  input: z.object({ meetingId: id('mtg'), notes: z.string().trim().max(8000).default('') }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const meeting = await lockMeeting(db, input.meetingId);
    if (meeting.status !== 'held') {
      throw new MeetingRuleError('wrong_step', 'Only a meeting held publishes its record.');
    }
    const { rows } = await db.query<{ on_time: boolean }>(
      `update meetings set status = 'recorded', notes = $2, recorded_at = now()
        where meeting_id = $1 returning recorded_at <= record_due_at as on_time`,
      [input.meetingId, input.notes],
    );
    return { meetingId: input.meetingId, onTime: rows[0]?.on_time ?? null };
  },
  summarize: (input) => `Record of ${input.meetingId} published`,
});

export const draftNote = defineCommand({
  name: 'draft-note',
  input: z.object({
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
    signedByPersonId: id('prs'),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const noteId = newId('dnt');
    await db
      .query(
        `insert into decision_notes (note_id, organization_id, subject, body, signed_by_person_id)
         values ($1, $2, $3, $4, $5)`,
        [noteId, organizationId, input.subject, input.body, input.signedByPersonId],
      )
      .catch((error: { code?: string }) => {
        if (error.code === '23503') throw new MeetingRuleError('not_found', 'No such person.');
        throw error;
      });
    return { noteId };
  },
  summarize: (input) => `Decision note « ${input.subject} » drafted`,
});

/**
 * Publishes a note with the next number of its year: `2026-012/DG/KEG`, the code being the top
 * unit's. Numbers never repeat and never skip back.
 */
export const publishNote = defineCommand({
  name: 'publish-note',
  input: z.object({ noteId: id('dnt') }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const { rows } = await db.query<{ status: string }>(
      `select status from decision_notes where note_id = $1 for update`,
      [input.noteId],
    );
    if (!rows[0]) throw new MeetingRuleError('not_found', 'No such note.');
    if (rows[0].status !== 'draft') throw new MeetingRuleError('wrong_step', 'Already published.');
    // One numbering per organization and year: taken under a lock on the organization's notes.
    await db.query(`lock table decision_notes in share row exclusive mode`);
    const year = new Date().getUTCFullYear();
    const { rows: next } = await db.query<{ seq: number }>(
      `select coalesce(max(seq), 0) + 1 as seq from decision_notes where year = $1`,
      [year],
    );
    const { rows: top } = await db.query<{ code: string | null }>(
      `select code from units where parent_id is null order by created_at limit 1`,
    );
    const seq = next[0]?.seq ?? 1;
    const number = `${year}-${String(seq).padStart(3, '0')}/DG/${top[0]?.code ?? 'ORG'}`;
    await db.query(
      `update decision_notes set status = 'published', year = $2, seq = $3, number = $4,
         published_on = current_date where note_id = $1`,
      [input.noteId, year, seq, number],
    );
    return { noteId: input.noteId, number };
  },
  summarize: (input) => `Decision note ${input.noteId} published`,
});

export const readNote = defineCommand({
  name: 'read-note',
  input: z.object({ noteId: id('dnt'), personId: id('prs') }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    await db.query(
      `insert into note_reads (organization_id, note_id, person_id) values ($1, $2, $3)
       on conflict do nothing`,
      [organizationId, input.noteId, input.personId],
    );
    return input;
  },
  summarize: (input) => `Note ${input.noteId} read`,
});
