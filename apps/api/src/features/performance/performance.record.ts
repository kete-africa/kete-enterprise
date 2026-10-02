import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is written YYYY-MM-DD.');
const text = (max: number) => z.string().trim().min(1).max(max);
const share = z.number().min(0).max(1);

export const quarterId = id('pqt');
export const reviewId = id('rvw');
export const profileId = id('jpf');

const comparison = z.enum(['<', '<=', '>', '>=']);
const malus = z.array(z.object({ upTo: z.number().int().min(0).nullable(), coefficient: share }));

/** A line of a profile: an indicator with its six attributes, as the referential writes them. */
export const profileLineInput = z.object({
  name: text(300),
  formula: z.string().trim().max(1000).default(''),
  source: z.string().trim().max(600).default(''),
  frequency: z.string().trim().max(80).default(''),
  targetText: z.string().trim().max(200).default(''),
  thresholdText: z.string().trim().max(200).default(''),
  weight: share.nullable(),
  kind: z.enum(['scored', 'penalizing', 'blocking', 'malus']).default('scored'),
  direction: z.enum(['higher', 'lower']).nullable().default(null),
  target: z.number().nullable().default(null),
  threshold: z.number().nullable().default(null),
  alertWhen: comparison.nullable().default(null),
  malus: malus.nullable().optional(),
  reliable: z.boolean().default(true),
  leading: z.boolean().default(false),
});
export type ProfileLineInput = z.infer<typeof profileLineInput>;

export const splitInput = z.object({
  individual: share,
  collective: share,
  collectiveLabel: z.string().trim().max(40).nullable().default(null),
  group: share,
  note: z.string().trim().max(200).nullable().default(null),
});

export const profileInput = z.object({
  title: text(200),
  category: z.string().trim().max(20).default(''),
  direction: z.string().trim().max(200).nullable().default(null),
  weights: splitInput,
  lines: z.array(profileLineInput).min(1).max(12),
});
export type ProfileInput = z.infer<typeof profileInput>;

export const importReferentialInput = z.object({
  source: z.string().trim().max(300).default(''),
  profiles: z.array(profileInput).min(1).max(300),
});

export const assignProfileInput = z.object({
  positionId: id('pos'),
  profileId: profileId.nullable(),
});

export const createQuarterInput = z
  .object({
    label: text(40),
    startsOn: day,
    endsOn: day,
    progressive: z.boolean().default(false),
    scale: z
      .object({ green: share, orange: share, red: share })
      .default({ green: 1, orange: 0.6, red: 0 }),
  })
  .refine((q) => q.endsOn > q.startsOn, { message: 'A quarter ends after it starts.' });

export const quarterGestureInput = z.object({ quarterId });

export const measureInput = z.object({
  reviewId,
  lines: z
    .array(
      z.object({
        position: z.number().int().min(1).max(20),
        value: z.number().nullable(),
        colour: z.enum(['green', 'orange', 'red']).nullable().optional(),
        proof: z.string().trim().max(600).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const fromSurveyInput = z.object({
  reviewId,
  position: z.number().int().min(1).max(20),
  campaignId: id('scp'),
});

export const collectiveFactorInput = z.object({
  quarterId,
  unitId: id('unt'),
  factor: share,
});

export const groupFactorInput = z.object({
  quarterId,
  factor: share,
  triggered: z.boolean(),
});

export const recordInput = z.object({
  reviewId,
  facts: z.string().trim().max(4000).default(''),
  difficulties: z.string().trim().max(4000).default(''),
  support: z.string().trim().max(4000).default(''),
  /** The share of the position's protocols respected over the quarter, as the manager notes it. */
  protocols: z.number().min(0).max(100).nullable().default(null),
});

export const signInput = z.object({
  reviewId,
  observations: z.string().trim().max(4000).optional(),
});

export const reviewGestureInput = z.object({ reviewId });

export type QuarterStatus = 'draft' | 'open' | 'measured' | 'closed';
export type ReviewStatus =
  'open' | 'measured' | 'manager_signed' | 'signed' | 'validated' | 'missed';
