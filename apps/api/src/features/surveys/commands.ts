import { defineCommand } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { queueMail, renderMail, type Locale } from '../mail/index.js';
import { issuePass, revokePasses } from '../passes/index.js';
import { drawRespondents } from './draw.js';
import {
  findCampaign,
  findQuestionnaire,
  findRespondent,
  formsOfRespondent,
  insertCampaign,
  insertForm,
  insertQuestionnaire,
  insertRespondent,
  listRespondents,
  lockForm,
  markSent,
  markStarted,
  replaceQuestionnaire,
  respondentIdsOf,
  setCampaignStatus,
  submitFormRow,
  writeAnswers,
} from './infrastructure/surveys.tables.js';
import { cleanAnswers, missingAnswers } from './scores.js';
import {
  campaignGestureInput,
  copyQuestionnaireInput,
  createCampaignInput,
  resendLinkInput,
  saveAnswersInput,
  saveQuestionnaireInput,
  submitFormInput,
  type Campaign,
  type Respondent,
} from './surveys.record.js';
import { surveyWords } from './words.js';

/** The purpose of the surveys' personal links; their reference is the respondent. */
export const answerPurpose = 'surveys.answer';

/** A rule of the surveys was not met: the change is refused, nothing is written. */
export class SurveyRuleError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'used'
      | 'not_draft'
      | 'not_open'
      | 'not_closed'
      | 'submitted'
      | 'incomplete'
      | 'not_yours'
      | 'nobody',
    message: string,
  ) {
    super(message);
    this.name = 'SurveyRuleError';
  }
}

function notFound(what: string): never {
  throw new SurveyRuleError('not_found', `${what} does not exist here.`);
}

async function unitsExist(db: SqlExecutor, unitIds: string[]): Promise<boolean> {
  if (unitIds.length === 0) return true;
  const { rows } = await db.query<{ count: string }>(
    `select count(*) from units where unit_id = any($1::text[])`,
    [unitIds],
  );
  return Number(rows[0]?.count ?? 0) === new Set(unitIds).size;
}

/** The organization as people know it: the name of its top unit. */
async function senderName(db: SqlExecutor): Promise<string> {
  const { rows } = await db.query<{ name: string }>(
    `select name from units where parent_id is null order by created_at limit 1`,
  );
  return rows[0]?.name ?? 'Kete Enterprise';
}

const dateIn = (day: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long' }).format(
    new Date(`${day}T12:00:00Z`),
  );

/**
 * Sends a respondent her personal link (a new one replaces the previous), in the gesture's
 * transaction. Without an e-mail, the link goes to whoever runs the campaign, to pass on by hand.
 * The link itself never enters the journal: only the e-mail carries it.
 */
async function sendLink(
  db: SqlExecutor,
  organizationId: string,
  campaign: Campaign,
  respondent: Pick<Respondent, 'respondentId' | 'personId' | 'name' | 'email'>,
  kind: 'invite' | 'reminder',
  relayEmail: string | null,
  locale: Locale = 'fr',
): Promise<'sent' | 'relayed' | 'unreached'> {
  const to = respondent.email ?? relayEmail;
  if (!to) return 'unreached';
  const expiresAt = new Date(`${campaign.closesOn}T23:59:59Z`);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
  const { url } = await issuePass(db, organizationId, {
    personId: respondent.personId,
    purpose: answerPurpose,
    reference: respondent.respondentId,
    expiresAt,
  });
  const w = surveyWords(locale);
  const closes = dateIn(campaign.closesOn, locale);
  const relayed = !respondent.email;
  const mail = renderMail({
    locale,
    sender: await senderName(db),
    greeting: relayed ? w.relayGreeting : w.greeting(respondent.name),
    paragraphs: [
      ...(relayed ? [w.relay(respondent.name)] : []),
      kind === 'invite'
        ? w.invite(campaign.title, campaign.period, closes)
        : w.reminder(campaign.title, closes),
      campaign.anonymous ? w.anonymous : w.named,
    ],
    action: { label: w.action, url },
    reason: relayed ? w.relayReason : w.reason,
  });
  await queueMail(db, organizationId, {
    to,
    subject: relayed
      ? w.relaySubject(respondent.name, campaign.title)
      : kind === 'invite'
        ? w.inviteSubject(campaign.title)
        : w.reminderSubject(campaign.title),
    ...mail,
    purpose: answerPurpose,
  });
  await markSent(db, respondent.respondentId);
  return relayed ? 'relayed' : 'sent';
}

export const saveQuestionnaire = defineCommand({
  name: 'save-questionnaire',
  input: saveQuestionnaireInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const unitIds = input.content.sections.flatMap((s) => (s.unitId ? [s.unitId] : []));
    if (!(await unitsExist(db, unitIds))) notFound('A unit of a section');
    if (!input.questionnaireId) {
      return { questionnaireId: await insertQuestionnaire(db, organizationId, input) };
    }
    const existing = await findQuestionnaire(db, input.questionnaireId);
    if (!existing) notFound('The questionnaire');
    // Answers already given were given to these words: a used questionnaire is copied, not edited.
    if (existing.used) {
      throw new SurveyRuleError('used', 'A campaign used this questionnaire: copy it instead.');
    }
    await replaceQuestionnaire(db, input.questionnaireId, input);
    return { questionnaireId: input.questionnaireId };
  },
  summarize: (input) => `Questionnaire « ${input.title} » saved`,
});

export const copyQuestionnaire = defineCommand({
  name: 'copy-questionnaire',
  input: copyQuestionnaireInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const source = await findQuestionnaire(db, input.questionnaireId);
    if (!source) notFound('The questionnaire');
    const questionnaireId = await insertQuestionnaire(db, organizationId, {
      title: source.title,
      ...(source.description ? { description: source.description } : {}),
      anonymous: source.anonymous,
      content: source.content,
      version: source.version + 1,
      copiedFrom: source.questionnaireId,
    });
    return { questionnaireId };
  },
  summarize: (input) => `Questionnaire ${input.questionnaireId} copied`,
});

export const createCampaign = defineCommand({
  name: 'create-campaign',
  input: createCampaignInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const questionnaire = await findQuestionnaire(db, input.questionnaireId);
    if (!questionnaire) notFound('The questionnaire');
    if (input.audience.kind === 'units' && !(await unitsExist(db, input.audience.unitIds))) {
      notFound('A unit of the audience');
    }
    const campaignId = await insertCampaign(db, organizationId, {
      ...input,
      anonymous: questionnaire.anonymous,
    }).catch((error: { code?: string }) => {
      if (error.code === '23503') notFound('The person about whom');
      throw error;
    });
    return { campaignId };
  },
  summarize: (input) => `Campaign « ${input.title} » (${input.period}) prepared`,
});

const withRelay = campaignGestureInput.extend({
  /** Where links of people without an e-mail go: the e-mail of whoever runs it (set by the API). */
  relayEmail: z.email().nullable(),
});

export const openCampaign = defineCommand({
  name: 'open-campaign',
  input: withRelay,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const campaign = await findCampaign(db, input.campaignId, { lock: true });
    if (!campaign) notFound('The campaign');
    if (campaign.status !== 'draft') {
      throw new SurveyRuleError('not_draft', 'This campaign was already opened.');
    }
    const questionnaire = await findQuestionnaire(db, campaign.questionnaireId);
    if (!questionnaire) notFound('The questionnaire');
    const today = new Date().toISOString().slice(0, 10);
    const drawn = await drawRespondents(db, {
      audience: campaign.audience,
      about: campaign.about,
      aboutPersonId: campaign.aboutPersonId,
      asOf: today,
    });
    if (drawn.length === 0) throw new SurveyRuleError('nobody', 'Nobody is in this audience.');
    // The questionnaire is frozen as it is now: later edits do not touch these answers.
    await setCampaignStatus(db, campaign.campaignId, 'open', questionnaire.content);
    const opened = { ...campaign, status: 'open' as const, form: questionnaire.content };
    let forms = 0;
    const reach = { sent: 0, relayed: 0, unreached: 0 };
    for (const person of drawn) {
      const respondentId = await insertRespondent(db, organizationId, {
        campaignId: campaign.campaignId,
        personId: person.personId,
        name: person.name,
        email: person.email,
      });
      for (const about of person.about) {
        await insertForm(db, organizationId, {
          campaignId: campaign.campaignId,
          respondentId,
          aboutPersonId: about,
        });
        forms += 1;
      }
      const outcome = await sendLink(
        db,
        organizationId,
        opened,
        { respondentId, personId: person.personId, name: person.name, email: person.email },
        'invite',
        input.relayEmail,
      );
      reach[outcome] += 1;
    }
    return { campaignId: campaign.campaignId, respondents: drawn.length, forms, ...reach };
  },
  summarize: (input) => `Campaign ${input.campaignId} opened`,
});

export const remindCampaign = defineCommand({
  name: 'remind-campaign',
  input: withRelay,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const campaign = await findCampaign(db, input.campaignId);
    if (!campaign) notFound('The campaign');
    if (campaign.status !== 'open') throw new SurveyRuleError('not_open', 'It is not open.');
    const waiting = await listRespondents(db, campaign.campaignId, { notSubmitted: true });
    for (const respondent of waiting) {
      await sendLink(db, organizationId, campaign, respondent, 'reminder', input.relayEmail);
    }
    return { campaignId: campaign.campaignId, reminded: waiting.length };
  },
  summarize: (input) => `Campaign ${input.campaignId}: reminders sent`,
});

export const resendLink = defineCommand({
  name: 'resend-link',
  input: resendLinkInput.extend({ relayEmail: z.email().nullable() }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const respondent = await findRespondent(db, input.respondentId);
    if (!respondent) notFound('The respondent');
    const campaign = await findCampaign(db, respondent.campaignId);
    if (!campaign || campaign.status !== 'open') {
      throw new SurveyRuleError('not_open', 'The campaign is not open.');
    }
    const outcome = await sendLink(
      db,
      organizationId,
      campaign,
      respondent,
      'reminder',
      input.relayEmail,
    );
    return { respondentId: respondent.respondentId, outcome };
  },
  summarize: (input) => `A new link for respondent ${input.respondentId}`,
});

export const closeCampaign = defineCommand({
  name: 'close-campaign',
  input: campaignGestureInput,
  reversibility: { reversible: true, inverse: 'reopen-campaign' },
  async handler(input, { db }) {
    const campaign = await findCampaign(db, input.campaignId, { lock: true });
    if (!campaign) notFound('The campaign');
    if (campaign.status !== 'open') throw new SurveyRuleError('not_open', 'It is not open.');
    await setCampaignStatus(db, campaign.campaignId, 'closed');
    // Its links open nothing any more.
    const revoked = await revokePasses(
      db,
      answerPurpose,
      await respondentIdsOf(db, campaign.campaignId),
    );
    return { campaignId: campaign.campaignId, revoked };
  },
  summarize: (input) => `Campaign ${input.campaignId} closed`,
});

export const reopenCampaign = defineCommand({
  name: 'reopen-campaign',
  input: withRelay,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const campaign = await findCampaign(db, input.campaignId, { lock: true });
    if (!campaign) notFound('The campaign');
    if (campaign.status !== 'closed') {
      throw new SurveyRuleError(
        'not_closed',
        'Only a closed campaign, not yet published, reopens.',
      );
    }
    await setCampaignStatus(db, campaign.campaignId, 'open');
    const waiting = await listRespondents(db, campaign.campaignId, { notSubmitted: true });
    for (const respondent of waiting) {
      await sendLink(db, organizationId, campaign, respondent, 'reminder', input.relayEmail);
    }
    return { campaignId: campaign.campaignId, reminded: waiting.length };
  },
  summarize: (input) => `Campaign ${input.campaignId} reopened`,
});

export const publishResults = defineCommand({
  name: 'publish-results',
  input: campaignGestureInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const campaign = await findCampaign(db, input.campaignId, { lock: true });
    if (!campaign) notFound('The campaign');
    if (campaign.status !== 'closed') {
      throw new SurveyRuleError('not_closed', 'Results are published once the campaign is closed.');
    }
    await setCampaignStatus(db, campaign.campaignId, 'published');
    return { campaignId: campaign.campaignId };
  },
  summarize: (input) => `Results of campaign ${input.campaignId} published`,
});

/** The form, if it belongs to this respondent and can still change. */
async function ownForm(db: SqlExecutor, formId: string, respondentId: string) {
  const form = await lockForm(db, formId);
  if (!form) notFound('The form');
  if (form.respondentId !== respondentId) {
    throw new SurveyRuleError('not_yours', 'This form is not yours.');
  }
  if (form.status === 'submitted') throw new SurveyRuleError('submitted', 'It was already sent.');
  const campaign = await findCampaign(db, form.campaignId);
  if (!campaign?.form || campaign.status !== 'open') {
    throw new SurveyRuleError('not_open', 'The campaign is not open.');
  }
  return { form: { formId: form.formId, respondentId }, campaign, content: campaign.form };
}

/** The respondent answering: set by the API from the link or the account, never by the caller. */
const answering = z.object({ respondentId: z.string().regex(/^srp_[0-9a-f-]{8,64}$/) });

export const saveAnswers = defineCommand({
  name: 'save-answers',
  input: saveAnswersInput.extend(answering.shape),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const { content } = await ownForm(db, input.formId, input.respondentId);
    await writeAnswers(db, input.formId, cleanAnswers(content, input.answers));
    await markStarted(db, input.respondentId);
    return { formId: input.formId, status: 'draft' };
  },
  summarize: (input) => `Form ${input.formId}: answers saved`,
  // The answers are the respondent's: the journal keeps the gesture, not them.
  journalInput: false,
});

export const submitForm = defineCommand({
  name: 'submit-form',
  input: submitFormInput.extend(answering.shape),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const { form, campaign, content } = await ownForm(db, input.formId, input.respondentId);
    const answers = cleanAnswers(content, input.answers);
    const missing = missingAnswers(content, answers);
    if (missing.length > 0) {
      throw new SurveyRuleError('incomplete', `Still to answer: ${missing.join(', ')}.`);
    }
    await submitFormRow(db, form, answers, campaign.anonymous);
    return { formId: input.formId, status: 'submitted' };
  },
  summarize: (input) => `Form ${input.formId} submitted`,
  journalInput: false,
});

export { formsOfRespondent };
