import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is written YYYY-MM-DD.');
const key = z.string().regex(/^[a-z0-9_]{1,40}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

export const questionnaireId = id('qst');
export const campaignId = id('scp');
export const respondentId = id('srp');
export const formId = id('sfm');

/** A question: a 1-to-5 rating, a free text, or a yes/no. */
export const question = z.object({
  key,
  type: z.enum(['rating', 'text', 'yes_no']),
  label: text(400),
  required: z.boolean().default(true),
  /** A rating may be answered « not applicable »: it then counts in no score. */
  allowNa: z.boolean().default(true),
});
export type Question = z.infer<typeof question>;

/** A section, possibly about a unit (« the IT service »): its ratings score that unit. */
export const section = z.object({
  key,
  title: text(200),
  description: z.string().trim().max(1000).optional(),
  unitId: id('unt').optional(),
  questions: z.array(question).min(1).max(60),
});
export type Section = z.infer<typeof section>;

export const formContent = z
  .object({ sections: z.array(section).min(1).max(30) })
  .refine((c) => new Set(c.sections.map((s) => s.key)).size === c.sections.length, {
    message: 'Two sections share a key.',
  })
  .refine(
    (c) => {
      const keys = c.sections.flatMap((s) => s.questions.map((q) => q.key));
      return new Set(keys).size === keys.length;
    },
    { message: 'Two questions share a key.' },
  );
export type FormContent = z.infer<typeof formContent>;

export const saveQuestionnaireInput = z.object({
  /** Absent: a new questionnaire. Present: replaces one no campaign has used. */
  questionnaireId: questionnaireId.optional(),
  title: text(200),
  description: z.string().trim().max(2000).optional(),
  anonymous: z.boolean(),
  content: formContent,
});

export const copyQuestionnaireInput = z.object({ questionnaireId });

/** Who answers: everyone, the people of some units (and below), or people outside. */
export const audience = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everyone') }),
  z.object({ kind: z.literal('units'), unitIds: z.array(id('unt')).min(1).max(100) }),
  z.object({
    kind: z.literal('outside'),
    people: z
      .array(z.object({ name: text(160), email: z.email() }))
      .min(1)
      .max(2000),
  }),
]);
export type Audience = z.infer<typeof audience>;

/** About whom each respondent answers. */
export const aboutKinds = ['none', 'manager', 'reports', 'person'] as const;
export type About = (typeof aboutKinds)[number];

export const createCampaignInput = z
  .object({
    questionnaireId,
    title: text(200),
    /** The period it measures: « T3 2026 », « S2 2026 ». */
    period: text(40),
    opensOn: day,
    closesOn: day,
    audience,
    about: z.enum(aboutKinds).default('none'),
    aboutPersonId: id('prs').optional(),
    /** Below this many answers, an anonymous group shows no score. */
    minGroup: z.number().int().min(1).max(20).default(3),
  })
  .refine((c) => c.closesOn >= c.opensOn, { message: 'A campaign closes after it opens.' })
  .refine((c) => (c.about === 'person') === Boolean(c.aboutPersonId), {
    message: 'Name the person, and only when the campaign is about one person.',
  })
  .refine((c) => c.audience.kind !== 'outside' || c.about === 'none', {
    message: 'People outside answer about the organization, not about a colleague.',
  });

export const campaignGestureInput = z.object({ campaignId });
export const resendLinkInput = z.object({ respondentId });

/** An answer: a rating 1–5, « na », a text, or yes/no. */
export const answerValue = z.union([
  z.number().int().min(1).max(5),
  z.literal('na'),
  z.string().max(4000),
  z.boolean(),
]);
export const answers = z.record(key, answerValue);
export type Answers = z.infer<typeof answers>;

export const saveAnswersInput = z.object({ formId, answers });
export const submitFormInput = z.object({ formId, answers });

export type CampaignStatus = 'draft' | 'open' | 'closed' | 'published';

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

export interface Campaign {
  campaignId: string;
  questionnaireId: string;
  title: string;
  period: string;
  opensOn: string;
  closesOn: string;
  status: CampaignStatus;
  anonymous: boolean;
  audience: Audience;
  about: About;
  aboutPersonId: string | null;
  minGroup: number;
  /** The questionnaire as it was when the campaign opened; the current one while a draft. */
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

export interface SurveyForm {
  formId: string;
  aboutPersonId: string | null;
  aboutName: string | null;
  status: 'draft' | 'submitted';
  answers: Answers;
}
