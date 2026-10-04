import { extract, type Metering } from '@kete/ai';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { transcribe } from 'ai';
import { z } from 'zod';
import {
  organizationLanguageModel,
  organizationTranscriptionModel,
} from '../../platform/models.js';
import type { Meeting } from './meetings.js';

// A meeting's record prepared from what was said (spec 035): its audio transcribed — the audio
// itself never kept — or its transcript pasted; the model proposes the record and the decisions,
// each with its owner and deadline; the person who runs the meeting corrects and publishes them.

export function meetingRecordsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.meeting_transcripts (
  organization_id text not null,
  meeting_id text not null,
  text text not null check (length(text) between 1 and 400000),
  source text not null check (source in ('audio', 'text')),
  language text,
  proposal jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, meeting_id),
  foreign key (organization_id, meeting_id) references ${s}.meetings (organization_id, meeting_id)
);
${organizationPolicySql({ schema: s, table: 'meeting_transcripts', appRole: options.appRole })}
grant select, insert, update on ${s}.meeting_transcripts to ${options.appRole};
`;
}

export class RecordError extends Error {
  constructor(
    readonly code: 'transcription_unavailable' | 'assistant_unavailable' | 'no_transcript',
    message: string,
  ) {
    super(message);
    this.name = 'RecordError';
  }
}

/** A recording, as the transcription model reads it. */
export async function transcribeAudio(
  audio: Uint8Array,
  metering: Metering,
): Promise<{ text: string; language: string | null }> {
  const model = organizationTranscriptionModel();
  if (!model) throw new RecordError('transcription_unavailable', 'No transcription model.');
  await metering.store.check(metering.context);
  const result = await transcribe({ model, audio });
  await metering.store.record(
    {
      ...metering.context,
      model: typeof model === 'string' ? model : `${model.provider}:${model.modelId}`,
    },
    { inputTokens: 0, outputTokens: 0, modelCalls: 1 },
  );
  return { text: result.text.trim(), language: result.language ?? null };
}

export interface Transcript {
  meetingId: string;
  text: string;
  source: 'audio' | 'text';
  language: string | null;
  proposal: Proposal | null;
  updatedAt: string;
}

export async function saveTranscript(
  db: SqlExecutor,
  input: {
    organizationId: string;
    meetingId: string;
    text: string;
    source: 'audio' | 'text';
    language: string | null;
    by: string;
  },
): Promise<void> {
  await db.query(
    `insert into meeting_transcripts (organization_id, meeting_id, text, source, language, created_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, meeting_id) do update set text = $3, source = $4,
       language = $5, proposal = null, updated_at = now()`,
    [input.organizationId, input.meetingId, input.text, input.source, input.language, input.by],
  );
}

export async function readTranscript(
  db: SqlExecutor,
  meetingId: string,
): Promise<Transcript | null> {
  const { rows } = await db.query<{
    meeting_id: string;
    text: string;
    source: 'audio' | 'text';
    language: string | null;
    proposal: Proposal | null;
    updated_at: Date;
  }>(
    `select meeting_id, text, source, language, proposal, updated_at from meeting_transcripts
      where meeting_id = $1`,
    [meetingId],
  );
  const r = rows[0];
  return r
    ? {
        meetingId: r.meeting_id,
        text: r.text,
        source: r.source,
        language: r.language,
        proposal: r.proposal,
        updatedAt: r.updated_at.toISOString(),
      }
    : null;
}

/** What the model proposes; the person corrects it before anything is recorded. */
export const proposalShape = z.object({
  notes: z.string().max(8000).describe('Le compte rendu en Markdown : points discutés, constats'),
  decisions: z
    .array(
      z.object({
        text: z.string().min(1).max(2000).describe('La décision, formulée comme une action'),
        responsiblePersonId: z
          .string()
          .nullable()
          .describe('L’identifiant de la personne responsable parmi les présents, ou null'),
        dueOn: z.string().nullable().describe('L’échéance AAAA-MM-JJ si elle a été dite, ou null'),
        idea: z.boolean().describe('Vrai pour une idée à garder plutôt qu’une décision'),
      }),
    )
    .max(50),
});
export type Proposal = z.infer<typeof proposalShape>;

/**
 * The record the model proposes from the transcript, the agenda and who was present. Owners are
 * only people present; a deadline only one that was said.
 */
export async function proposeRecord(
  meeting: Meeting,
  transcript: string,
  people: { personId: string; name: string }[],
  metering: Metering,
): Promise<Proposal> {
  const model = organizationLanguageModel();
  if (!model) throw new RecordError('assistant_unavailable', 'No model is configured.');
  const present = people.filter((p) => meeting.presentPersonIds.includes(p.personId));
  const { value } = await extract({
    model,
    schema: proposalShape,
    system:
      'Tu prépares le compte rendu d’une réunion à partir de sa transcription. Écris un compte rendu ' +
      'factuel et bref ; puis chaque décision prise, avec son responsable (seulement parmi les ' +
      'présents, par son identifiant) et son échéance si elle a été dite. N’invente rien : ce qui ' +
      'n’a pas été décidé n’est pas une décision.',
    prompt: [
      `Réunion : ${meeting.title} (${meeting.typeName}), le ${meeting.startsAt.slice(0, 10)}.`,
      `Ordre du jour :\n${meeting.agenda.map((a) => `- ${a.title}`).join('\n') || '- (aucun)'}`,
      `Présents :\n${present.map((p) => `- ${p.name} (${p.personId})`).join('\n') || '- (non renseignés)'}`,
      `Transcription :\n${transcript.slice(0, 120_000)}`,
    ].join('\n\n'),
    metering,
  });
  const allowed = new Set(present.map((p) => p.personId));
  return {
    notes: value.notes,
    decisions: value.decisions.map((d) => ({
      ...d,
      responsiblePersonId:
        d.responsiblePersonId && allowed.has(d.responsiblePersonId) ? d.responsiblePersonId : null,
      dueOn: d.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(d.dueOn) ? d.dueOn : null,
    })),
  };
}

export async function keepProposal(
  db: SqlExecutor,
  meetingId: string,
  proposal: Proposal,
): Promise<void> {
  await db.query(
    `update meeting_transcripts set proposal = $2, updated_at = now() where meeting_id = $1`,
    [meetingId, JSON.stringify(proposal)],
  );
}
