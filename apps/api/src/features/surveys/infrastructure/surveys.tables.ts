import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type {
  About,
  Answers,
  Audience,
  Campaign,
  CampaignStatus,
  FormContent,
  Questionnaire,
  Respondent,
  SurveyForm,
} from '../surveys.record.js';

/**
 * Questionnaires, campaigns, respondents and forms (spec 011), each with its row-level security in
 * the same migration. A submitted form of an anonymous campaign loses its respondent: nothing in the
 * database ties those answers to a person any more.
 */
export function surveysMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.questionnaires (
  questionnaire_id text primary key,
  organization_id text not null,
  title text not null check (length(title) between 1 and 200),
  description text,
  anonymous boolean not null,
  content jsonb not null,
  version integer not null default 1,
  copied_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, questionnaire_id)
);
${policy('questionnaires')}

create table ${s}.survey_campaigns (
  campaign_id text primary key,
  organization_id text not null,
  questionnaire_id text not null,
  title text not null check (length(title) between 1 and 200),
  period text not null check (length(period) between 1 and 40),
  opens_on date not null,
  closes_on date not null check (closes_on >= opens_on),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'published')),
  anonymous boolean not null,
  form jsonb,
  audience jsonb not null,
  about text not null check (about in ('none', 'manager', 'reports', 'person')),
  about_person_id text,
  min_group integer not null default 3 check (min_group between 1 and 20),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  published_at timestamptz,
  unique (organization_id, campaign_id),
  foreign key (organization_id, questionnaire_id)
    references ${s}.questionnaires (organization_id, questionnaire_id),
  foreign key (organization_id, about_person_id) references ${s}.people (organization_id, person_id)
);
${policy('survey_campaigns')}

create table ${s}.survey_respondents (
  respondent_id text primary key,
  organization_id text not null,
  campaign_id text not null,
  person_id text,
  name text not null,
  email text,
  status text not null default 'pending' check (status in ('pending', 'started', 'submitted')),
  forms_total integer not null default 0,
  forms_submitted integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, respondent_id),
  unique (campaign_id, person_id),
  foreign key (organization_id, campaign_id)
    references ${s}.survey_campaigns (organization_id, campaign_id),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id)
);
create index survey_respondents_person on ${s}.survey_respondents (organization_id, person_id);
${policy('survey_respondents')}

create table ${s}.survey_forms (
  form_id text primary key,
  organization_id text not null,
  campaign_id text not null,
  respondent_id text,
  about_person_id text,
  answers jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  foreign key (organization_id, campaign_id)
    references ${s}.survey_campaigns (organization_id, campaign_id),
  foreign key (organization_id, respondent_id)
    references ${s}.survey_respondents (organization_id, respondent_id),
  foreign key (organization_id, about_person_id) references ${s}.people (organization_id, person_id)
);
create index survey_forms_campaign on ${s}.survey_forms (organization_id, campaign_id, status);
create index survey_forms_respondent on ${s}.survey_forms (organization_id, respondent_id);
${policy('survey_forms')}

grant select, insert, update on ${s}.questionnaires, ${s}.survey_campaigns,
  ${s}.survey_respondents, ${s}.survey_forms to ${options.appRole};
`;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

type QuestionnaireRow = {
  questionnaire_id: string;
  title: string;
  description: string | null;
  anonymous: boolean;
  content: FormContent;
  version: number;
  used: boolean;
  updated_at: Date;
};
const questionnaireColumns = `q.questionnaire_id, q.title, q.description, q.anonymous, q.content,
  q.version, q.updated_at,
  exists (select 1 from survey_campaigns c where c.questionnaire_id = q.questionnaire_id
          and c.status <> 'draft') as used`;
const toQuestionnaire = (r: QuestionnaireRow): Questionnaire => ({
  questionnaireId: r.questionnaire_id,
  title: r.title,
  description: r.description,
  anonymous: r.anonymous,
  content: r.content,
  version: r.version,
  used: r.used,
  updatedAt: r.updated_at.toISOString(),
});

export async function listQuestionnaires(db: SqlExecutor): Promise<Questionnaire[]> {
  const { rows } = await db.query<QuestionnaireRow>(
    `select ${questionnaireColumns} from questionnaires q order by q.updated_at desc`,
  );
  return rows.map(toQuestionnaire);
}

export async function findQuestionnaire(
  db: SqlExecutor,
  questionnaireId: string,
): Promise<Questionnaire | null> {
  const { rows } = await db.query<QuestionnaireRow>(
    `select ${questionnaireColumns} from questionnaires q where q.questionnaire_id = $1`,
    [questionnaireId],
  );
  return rows[0] ? toQuestionnaire(rows[0]) : null;
}

export async function insertQuestionnaire(
  db: SqlExecutor,
  organizationId: string,
  input: {
    title: string;
    description?: string | undefined;
    anonymous: boolean;
    content: FormContent;
    version?: number;
    copiedFrom?: string;
  },
): Promise<string> {
  const questionnaireId = newId('qst');
  await db.query(
    `insert into questionnaires (questionnaire_id, organization_id, title, description, anonymous,
       content, version, copied_from)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      questionnaireId,
      organizationId,
      input.title,
      input.description ?? null,
      input.anonymous,
      JSON.stringify(input.content),
      input.version ?? 1,
      input.copiedFrom ?? null,
    ],
  );
  return questionnaireId;
}

export async function replaceQuestionnaire(
  db: SqlExecutor,
  questionnaireId: string,
  input: {
    title: string;
    description?: string | undefined;
    anonymous: boolean;
    content: FormContent;
  },
): Promise<void> {
  await db.query(
    `update questionnaires set title = $2, description = $3, anonymous = $4, content = $5,
       updated_at = now() where questionnaire_id = $1`,
    [
      questionnaireId,
      input.title,
      input.description ?? null,
      input.anonymous,
      JSON.stringify(input.content),
    ],
  );
}

type CampaignRow = {
  campaign_id: string;
  questionnaire_id: string;
  title: string;
  period: string;
  opens_on: string;
  closes_on: string;
  status: CampaignStatus;
  anonymous: boolean;
  audience: Audience;
  about: About;
  about_person_id: string | null;
  min_group: number;
  form: FormContent | null;
};
const campaignColumns = `campaign_id, questionnaire_id, title, period,
  to_char(opens_on, 'YYYY-MM-DD') as opens_on, to_char(closes_on, 'YYYY-MM-DD') as closes_on,
  status, anonymous, audience, about, about_person_id, min_group, form`;
const toCampaign = (r: CampaignRow): Campaign => ({
  campaignId: r.campaign_id,
  questionnaireId: r.questionnaire_id,
  title: r.title,
  period: r.period,
  opensOn: r.opens_on,
  closesOn: r.closes_on,
  status: r.status,
  anonymous: r.anonymous,
  audience: r.audience,
  about: r.about,
  aboutPersonId: r.about_person_id,
  minGroup: r.min_group,
  form: r.form,
});

export async function listCampaigns(db: SqlExecutor): Promise<Campaign[]> {
  const { rows } = await db.query<CampaignRow>(
    `select ${campaignColumns} from survey_campaigns order by created_at desc`,
  );
  return rows.map(toCampaign);
}

export async function findCampaign(
  db: SqlExecutor,
  campaignId: string,
  options: { lock?: boolean } = {},
): Promise<Campaign | null> {
  const { rows } = await db.query<CampaignRow>(
    `select ${campaignColumns} from survey_campaigns where campaign_id = $1
     ${options.lock ? 'for update' : ''}`,
    [campaignId],
  );
  return rows[0] ? toCampaign(rows[0]) : null;
}

export async function insertCampaign(
  db: SqlExecutor,
  organizationId: string,
  input: {
    questionnaireId: string;
    title: string;
    period: string;
    opensOn: string;
    closesOn: string;
    anonymous: boolean;
    audience: Audience;
    about: About;
    aboutPersonId?: string | undefined;
    minGroup: number;
  },
): Promise<string> {
  const campaignId = newId('scp');
  await db.query(
    `insert into survey_campaigns (campaign_id, organization_id, questionnaire_id, title, period,
       opens_on, closes_on, anonymous, audience, about, about_person_id, min_group)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      campaignId,
      organizationId,
      input.questionnaireId,
      input.title,
      input.period,
      input.opensOn,
      input.closesOn,
      input.anonymous,
      JSON.stringify(input.audience),
      input.about,
      input.aboutPersonId ?? null,
      input.minGroup,
    ],
  );
  return campaignId;
}

export async function setCampaignStatus(
  db: SqlExecutor,
  campaignId: string,
  status: CampaignStatus,
  form?: FormContent,
): Promise<void> {
  const stamp =
    status === 'open'
      ? 'opened_at = now(),'
      : status === 'closed'
        ? 'closed_at = now(),'
        : status === 'published'
          ? 'published_at = now(),'
          : '';
  await db.query(
    `update survey_campaigns set ${stamp} status = $2, form = coalesce($3::jsonb, form)
      where campaign_id = $1`,
    [campaignId, status, form ? JSON.stringify(form) : null],
  );
}

export async function insertRespondent(
  db: SqlExecutor,
  organizationId: string,
  input: { campaignId: string; personId: string | null; name: string; email: string | null },
): Promise<string> {
  const respondentId = newId('srp');
  await db.query(
    `insert into survey_respondents (respondent_id, organization_id, campaign_id, person_id, name,
       email)
     values ($1, $2, $3, $4, $5, $6)`,
    [respondentId, organizationId, input.campaignId, input.personId, input.name, input.email],
  );
  return respondentId;
}

export async function insertForm(
  db: SqlExecutor,
  organizationId: string,
  input: { campaignId: string; respondentId: string; aboutPersonId: string | null },
): Promise<void> {
  await db.query(
    `insert into survey_forms (form_id, organization_id, campaign_id, respondent_id,
       about_person_id)
     values ($1, $2, $3, $4, $5)`,
    [newId('sfm'), organizationId, input.campaignId, input.respondentId, input.aboutPersonId],
  );
  await db.query(
    `update survey_respondents set forms_total = forms_total + 1 where respondent_id = $1`,
    [input.respondentId],
  );
}

type RespondentRow = {
  respondent_id: string;
  person_id: string | null;
  name: string;
  email: string | null;
  status: Respondent['status'];
  forms_total: number;
  forms_submitted: number;
  last_sent_at: Date | null;
};
const respondentColumns = `respondent_id, person_id, name, email, status, forms_total,
  forms_submitted, last_sent_at`;
const toRespondent = (r: RespondentRow): Respondent => ({
  respondentId: r.respondent_id,
  personId: r.person_id,
  name: r.name,
  email: r.email,
  status: r.status,
  formsTotal: r.forms_total,
  formsSubmitted: r.forms_submitted,
  lastSentAt: iso(r.last_sent_at),
});

export async function listRespondents(
  db: SqlExecutor,
  campaignId: string,
  options: { notSubmitted?: boolean } = {},
): Promise<Respondent[]> {
  const { rows } = await db.query<RespondentRow>(
    `select ${respondentColumns} from survey_respondents where campaign_id = $1
     ${options.notSubmitted ? `and status <> 'submitted'` : ''} order by name`,
    [campaignId],
  );
  return rows.map(toRespondent);
}

export async function findRespondent(
  db: SqlExecutor,
  respondentId: string,
): Promise<(Respondent & { campaignId: string }) | null> {
  const { rows } = await db.query<RespondentRow & { campaign_id: string }>(
    `select ${respondentColumns}, campaign_id from survey_respondents where respondent_id = $1`,
    [respondentId],
  );
  const row = rows[0];
  return row ? { ...toRespondent(row), campaignId: row.campaign_id } : null;
}

export async function markSent(db: SqlExecutor, respondentId: string): Promise<void> {
  await db.query(`update survey_respondents set last_sent_at = now() where respondent_id = $1`, [
    respondentId,
  ]);
}

/** The person's respondents in open campaigns: what she has to fill in. */
export async function respondentsOfPerson(
  db: SqlExecutor,
  personId: string,
): Promise<
  (Respondent & { campaignId: string; title: string; period: string; closesOn: string })[]
> {
  const { rows } = await db.query<
    RespondentRow & { campaign_id: string; title: string; period: string; closes_on: string }
  >(
    `select r.respondent_id, r.person_id, r.name, r.email, r.status, r.forms_total,
       r.forms_submitted, r.last_sent_at, r.campaign_id, c.title, c.period,
       to_char(c.closes_on, 'YYYY-MM-DD') as closes_on
       from survey_respondents r join survey_campaigns c on c.campaign_id = r.campaign_id
      where r.person_id = $1 and c.status = 'open' order by c.closes_on`,
    [personId],
  );
  return rows.map((r) => ({
    ...toRespondent(r),
    campaignId: r.campaign_id,
    title: r.title,
    period: r.period,
    closesOn: r.closes_on,
  }));
}

type FormRow = {
  form_id: string;
  about_person_id: string | null;
  about_name: string | null;
  status: SurveyForm['status'];
  answers: Answers;
};

export async function formsOfRespondent(
  db: SqlExecutor,
  respondentId: string,
): Promise<SurveyForm[]> {
  const { rows } = await db.query<FormRow>(
    `select f.form_id, f.about_person_id, p.name as about_name, f.status, f.answers
       from survey_forms f left join people p on p.person_id = f.about_person_id
      where f.respondent_id = $1 order by p.name nulls first, f.form_id`,
    [respondentId],
  );
  return rows.map((r) => ({
    formId: r.form_id,
    aboutPersonId: r.about_person_id,
    aboutName: r.about_name,
    status: r.status,
    answers: r.answers,
  }));
}

export async function lockForm(
  db: SqlExecutor,
  formId: string,
): Promise<{
  formId: string;
  campaignId: string;
  respondentId: string | null;
  status: SurveyForm['status'];
} | null> {
  const { rows } = await db.query<{
    form_id: string;
    campaign_id: string;
    respondent_id: string | null;
    status: SurveyForm['status'];
  }>(
    `select form_id, campaign_id, respondent_id, status from survey_forms where form_id = $1
       for update`,
    [formId],
  );
  const row = rows[0];
  return row
    ? {
        formId: row.form_id,
        campaignId: row.campaign_id,
        respondentId: row.respondent_id,
        status: row.status,
      }
    : null;
}

export async function writeAnswers(db: SqlExecutor, formId: string, answers: Answers) {
  await db.query(`update survey_forms set answers = $2, updated_at = now() where form_id = $1`, [
    formId,
    JSON.stringify(answers),
  ]);
}

/**
 * Submits a form: it cannot change any more. In an anonymous campaign it loses its respondent, so
 * nothing ties the answers to a person; the respondent keeps only a count.
 */
export async function submitFormRow(
  db: SqlExecutor,
  form: { formId: string; respondentId: string },
  answers: Answers,
  anonymous: boolean,
): Promise<void> {
  await db.query(
    `update survey_forms set answers = $2, status = 'submitted', submitted_at = now(),
       updated_at = now(), respondent_id = case when $3 then null else respondent_id end
      where form_id = $1`,
    [form.formId, JSON.stringify(answers), anonymous],
  );
  await db.query(
    `update survey_respondents set forms_submitted = forms_submitted + 1,
       status = case when forms_submitted + 1 >= forms_total then 'submitted' else 'started' end
      where respondent_id = $1`,
    [form.respondentId],
  );
}

export async function markStarted(db: SqlExecutor, respondentId: string): Promise<void> {
  await db.query(
    `update survey_respondents set status = 'started'
      where respondent_id = $1 and status = 'pending'`,
    [respondentId],
  );
}

/** The submitted answers of a campaign, never with their respondent. */
export async function submittedForms(
  db: SqlExecutor,
  campaignId: string,
): Promise<{ aboutPersonId: string | null; aboutName: string | null; answers: Answers }[]> {
  const { rows } = await db.query<{
    about_person_id: string | null;
    about_name: string | null;
    answers: Answers;
  }>(
    `select f.about_person_id, p.name as about_name, f.answers
       from survey_forms f left join people p on p.person_id = f.about_person_id
      where f.campaign_id = $1 and f.status = 'submitted'`,
    [campaignId],
  );
  return rows.map((r) => ({
    aboutPersonId: r.about_person_id,
    aboutName: r.about_name,
    answers: r.answers,
  }));
}

export async function respondentIdsOf(db: SqlExecutor, campaignId: string): Promise<string[]> {
  const { rows } = await db.query<{ respondent_id: string }>(
    `select respondent_id from survey_respondents where campaign_id = $1`,
    [campaignId],
  );
  return rows.map((r) => r.respondent_id);
}

/** The people of the organization with a position at a date, with the units of their positions. */
export async function peopleAt(
  db: SqlExecutor,
  asOf: string,
): Promise<{ personId: string; name: string; email: string | null; unitIds: string[] }[]> {
  const { rows } = await db.query<{
    person_id: string;
    name: string;
    email: string | null;
    unit_ids: string[];
  }>(
    `select pe.person_id, pe.name, pe.email, array_agg(distinct po.unit_id) as unit_ids
       from people pe
       join assignments a on a.person_id = pe.person_id
        and a.starts_on <= $1::date and (a.ends_on is null or a.ends_on >= $1::date)
       join positions po on po.position_id = a.position_id
      group by pe.person_id, pe.name, pe.email order by pe.name`,
    [asOf],
  );
  return rows.map((r) => ({
    personId: r.person_id,
    name: r.name,
    email: r.email,
    unitIds: r.unit_ids,
  }));
}

/** The units under these units (themselves included). */
export async function subtreeOf(db: SqlExecutor, unitIds: string[]): Promise<Set<string>> {
  const { rows } = await db.query<{ unit_id: string }>(
    `with recursive down as (
       select unit_id from units where unit_id = any($1::text[])
       union
       select u.unit_id from units u join down d on u.parent_id = d.unit_id
     )
     select unit_id from down`,
    [unitIds],
  );
  return new Set(rows.map((r) => r.unit_id));
}
