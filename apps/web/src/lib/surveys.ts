import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, callPublic, sendGesture } from '@/platform/api';

// The surveys as the API serves them (spec 011).

export type QuestionType = 'rating' | 'text' | 'yes_no';
export interface Question {
  key: string;
  type: QuestionType;
  label: string;
  required: boolean;
  allowNa: boolean;
}
export interface Section {
  key: string;
  title: string;
  description?: string;
  unitId?: string;
  questions: Question[];
}
export interface FormContent {
  sections: Section[];
}
export type AnswerValue = number | 'na' | string | boolean;
export type Answers = Record<string, AnswerValue>;

export interface Questionnaire {
  questionnaireId: string;
  title: string;
  description: string | null;
  anonymous: boolean;
  content: FormContent;
  version: number;
  used: boolean;
  updatedAt: string;
}

export type Audience =
  | { kind: 'everyone' }
  | { kind: 'units'; unitIds: string[] }
  | { kind: 'outside'; people: { name: string; email: string }[] };

export interface Campaign {
  campaignId: string;
  questionnaireId: string;
  title: string;
  period: string;
  opensOn: string;
  closesOn: string;
  status: 'draft' | 'open' | 'closed' | 'published';
  anonymous: boolean;
  audience: Audience;
  about: 'none' | 'manager' | 'reports' | 'person';
  aboutPersonId: string | null;
  minGroup: number;
  form: FormContent | null;
}

export interface Respondent {
  respondentId: string;
  personId: string | null;
  name: string;
  email: string | null;
  status: 'pending' | 'started' | 'submitted';
  formsTotal: number;
  formsSubmitted: number;
  lastSentAt: string | null;
}

export interface Group {
  count: number;
  score: number | null;
  hidden: boolean;
}
export interface Results {
  forms: number;
  overall: Group;
  sections: (Group & { key: string; title: string; unitId: string | null })[];
  questions: (Group & { key: string; sectionKey: string; label: string; yes?: number })[];
  people: (Group & { personId: string; name: string })[];
  texts: { sectionKey: string; questionKey: string; text: string }[];
}

export interface SurveyForm {
  formId: string;
  aboutPersonId: string | null;
  aboutName: string | null;
  status: 'draft' | 'submitted';
  answers: Answers;
}

/** What a respondent sees: her forms, on the campaign's frozen questionnaire. */
export interface AnswerScreen {
  campaign: {
    title: string;
    period: string;
    closesOn: string;
    anonymous: boolean;
    form: FormContent;
  };
  respondent: { name: string; status: string };
  forms: SurveyForm[];
}

export const fetchSurveys = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ questionnaires: Questionnaire[]; campaigns: Campaign[] }>(getRequest(), '/v1/surveys'),
);

const isId = (prefix: string, value: unknown): value is string =>
  typeof value === 'string' && new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`).test(value);

export const fetchCampaign = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const campaignId = (input as { campaignId?: unknown } | null)?.campaignId;
    if (!isId('scp', campaignId)) throw new Error('Unknown campaign.');
    return { campaignId };
  })
  .handler(({ data }) =>
    callApi<{ campaign: Campaign; respondents: Respondent[]; results: Results | null }>(
      getRequest(),
      `/v1/surveys/campaigns/${data.campaignId}`,
    ),
  );

const managePaths = [
  /^\/questionnaires$/,
  /^\/questionnaires\/qst_[0-9a-f-]+\/copy$/,
  /^\/campaigns$/,
  /^\/campaigns\/scp_[0-9a-f-]+\/(open|remind|close|reopen|publish)$/,
  /^\/respondents\/srp_[0-9a-f-]+\/resend$/,
];

/** A gesture of whoever runs the surveys. */
export const manageSurveys = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !managePaths.some((p) => p.test(path))) {
      throw new Error('Unknown gesture.');
    }
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<Record<string, string | number | boolean | null>>(
      getRequest(),
      `/v1/surveys${data.path}`,
      data.body,
      data.key,
    );
    return answer.ok
      ? { ok: true, error: null, data: answer.data }
      : { ok: false, error: answer.error, data: null };
  });

export interface MySurvey extends Respondent {
  campaignId: string;
  title: string;
  period: string;
  closesOn: string;
}

export const fetchMySurveys = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ surveys: MySurvey[] }>(getRequest(), '/v1/surveys/mine'),
);

export const fetchMySurvey = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const respondentId = (input as { respondentId?: unknown } | null)?.respondentId;
    if (!isId('srp', respondentId)) throw new Error('Unknown form.');
    return { respondentId };
  })
  .handler(({ data }) =>
    callApi<AnswerScreen>(getRequest(), `/v1/surveys/mine/${data.respondentId}`),
  );

interface AnswerInput {
  /** `mine:<respondentId>` for a signed-in person, `link:<token>` for a personal link. */
  via: string;
  formId: string;
  answers: Answers;
  submit: boolean;
  key: string;
}

/** Saves or sends a form, by account or by link: a refusal comes back as its code. */
export const answerSurvey = createServerFn({ method: 'POST' })
  .validator((input: unknown): AnswerInput => {
    const { via, formId, answers, submit, key } = (input ?? {}) as Partial<AnswerInput>;
    if (
      typeof via !== 'string' ||
      !/^(mine:srp_[0-9a-f-]{8,64}|link:[A-Za-z0-9_-]{43})$/.test(via)
    ) {
      throw new Error('Unknown form.');
    }
    if (!isId('sfm', formId)) throw new Error('Unknown form.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { via, formId, answers: answers ?? {}, submit: submit === true, key };
  })
  .handler(async ({ data }) => {
    const [kind, value] = data.via.split(':') as ['mine' | 'link', string];
    const suffix = `/forms/${data.formId}${data.submit ? '/submit' : ''}`;
    const answer =
      kind === 'mine'
        ? await sendGesture(
            getRequest(),
            `/v1/surveys/mine/${value}${suffix}`,
            { answers: data.answers },
            data.key,
          )
        : await callPublic(`/surveys/${value}${suffix}`, {
            method: 'POST',
            body: { answers: data.answers },
            idempotencyKey: data.key,
          });
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

export const fetchLinkSurvey = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const token = (input as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error('Unknown link.');
    }
    return { token };
  })
  .handler(async ({ data }) => {
    const answer = await callPublic<AnswerScreen>(`/surveys/${data.token}`);
    return answer.ok ? answer.data : null;
  });
