import { defineCommand } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { openAction } from '../actions/index.js';
import { queueMail, renderMail, type Locale } from '../mail/index.js';
import { issuePass } from '../passes/index.js';
import { findPerson, managerOfPosition } from '../structure/index.js';
import { surveyScores } from '../surveys/index.js';
import {
  colourOf,
  defaultScale,
  factorOf,
  fallbackOf,
  individualOf,
  type Colour,
  type Scale,
} from './compute.js';
import {
  findQuarter,
  findReview,
  holdersWithProfiles,
  insertQuarter,
  insertReview,
  listProfiles,
  listReviews,
  matchPositionsByTitle,
  previousFactors,
  profileExists,
  setGroup,
  setPositionProfile,
  setQuarterStatus,
  setUnitFactor,
  unitsUpward,
  updateReview,
  upsertProfile,
  writeLine,
  type Quarter,
  type Review,
} from './infrastructure/performance.tables.js';
import {
  assignProfileInput,
  collectiveFactorInput,
  createQuarterInput,
  fromSurveyInput,
  groupFactorInput,
  importReferentialInput,
  measureInput,
  quarterGestureInput,
  recordInput,
  reviewGestureInput,
  signInput,
} from './performance.record.js';
import { performanceWords } from './words.js';

/** The purpose of the reviews' personal links; their reference is the review. */
export const reviewPurpose = 'performance.review';

/** A rule of the reviews was not met: the change is refused, nothing is written. */
export class PerformanceRuleError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'not_draft'
      | 'not_open'
      | 'not_measured'
      | 'wrong_step'
      | 'not_reviewer'
      | 'not_yours'
      | 'weights'
      | 'nobody',
    message: string,
  ) {
    super(message);
    this.name = 'PerformanceRuleError';
  }
}

function notFound(what: string): never {
  throw new PerformanceRuleError('not_found', `${what} does not exist here.`);
}

async function senderName(db: SqlExecutor): Promise<string> {
  const { rows } = await db.query<{ name: string }>(
    `select name from units where parent_id is null order by created_at limit 1`,
  );
  return rows[0]?.name ?? 'Kete Enterprise';
}

/**
 * Writes to the person of a review with her personal link (a new one replaces the previous). With no
 * e-mail, the link goes to her manager's, or whoever acts, to pass on by hand.
 */
async function sendReviewLink(
  db: SqlExecutor,
  organizationId: string,
  review: {
    reviewId: string;
    personId: string;
    profileTitle: string;
    managerPersonId: string | null;
  },
  quarter: Quarter,
  kind: 'grid' | 'record',
  relayEmail: string | null,
  locale: Locale = 'fr',
): Promise<'sent' | 'relayed' | 'unreached'> {
  const person = await findPerson(db, review.personId);
  if (!person) return 'unreached';
  const manager = review.managerPersonId ? await findPerson(db, review.managerPersonId) : null;
  const to = person.email ?? manager?.email ?? relayEmail;
  if (!to) return 'unreached';
  const expiresAt = new Date(`${quarter.endsOn}T23:59:59Z`);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 60);
  const { url } = await issuePass(db, organizationId, {
    personId: person.personId,
    purpose: reviewPurpose,
    reference: review.reviewId,
    expiresAt,
  });
  const w = performanceWords(locale);
  const relayed = !person.email;
  const mail = renderMail({
    locale,
    sender: await senderName(db),
    greeting: relayed ? w.relayGreeting : w.greeting(person.name),
    paragraphs: [
      ...(relayed ? [w.relay(person.name)] : []),
      kind === 'grid'
        ? w.grid(quarter.label, review.profileTitle)
        : w.record(manager?.name ?? '', quarter.label),
    ],
    action: { label: w.action, url },
    reason: relayed ? w.relayReason : w.reason,
  });
  await queueMail(db, organizationId, {
    to,
    subject: relayed
      ? w.relaySubject(person.name, quarter.label)
      : kind === 'grid'
        ? w.gridSubject(quarter.label)
        : w.recordSubject(quarter.label),
    ...mail,
    purpose: reviewPurpose,
  });
  return relayed ? 'relayed' : 'sent';
}

// ---------------------------------------------------------------- the referential

export const importReferential = defineCommand({
  name: 'import-referential',
  input: importReferentialInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const refused: string[] = [];
    let profiles = 0;
    for (const profile of input.profiles) {
      const sum = profile.lines
        .filter((l) => l.kind !== 'malus' && l.weight !== null)
        .reduce((s, l) => s + (l.weight ?? 0), 0);
      // A grid whose weights do not make 100 % is an opinion, not a grid (§ 1.3).
      if (Math.abs(sum - 1) > 0.011) {
        refused.push(profile.title);
        continue;
      }
      await upsertProfile(db, organizationId, profile, input.source);
      profiles += 1;
    }
    const matched = await matchPositionsByTitle(db, organizationId);
    return { profiles, refused, matched };
  },
  summarize: (input) => `Referential imported: ${input.profiles.length} profile(s)`,
});

export const assignProfile = defineCommand({
  name: 'assign-profile',
  input: assignProfileInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    if (input.profileId && !(await profileExists(db, input.profileId))) notFound('The profile');
    await setPositionProfile(db, organizationId, input.positionId, input.profileId).catch(
      (error: { code?: string }) => {
        if (error.code === '23503') notFound('The position');
        throw error;
      },
    );
    return input;
  },
  summarize: (input) => `Position ${input.positionId}: profile ${input.profileId ?? 'none'}`,
});

// ---------------------------------------------------------------- quarters

export const createQuarter = defineCommand({
  name: 'create-quarter',
  input: createQuarterInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    return { quarterId: await insertQuarter(db, organizationId, input) };
  },
  summarize: (input) => `Quarter ${input.label} prepared`,
});

const withRelay = quarterGestureInput.extend({ relayEmail: z.email().nullable() });

export const openQuarter = defineCommand({
  name: 'open-quarter',
  input: withRelay,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const quarter = await findQuarter(db, input.quarterId, true);
    if (!quarter) notFound('The quarter');
    if (quarter.status !== 'draft') {
      throw new PerformanceRuleError('not_draft', 'This quarter was already opened.');
    }
    // Who holds the positions today, within the quarter: its first day for a quarter ahead, its
    // last for a quarter already over.
    const today = new Date().toISOString().slice(0, 10);
    const asOf =
      today < quarter.startsOn ? quarter.startsOn : today > quarter.endsOn ? quarter.endsOn : today;
    const holders = await holdersWithProfiles(db, asOf);
    if (holders.length === 0) {
      throw new PerformanceRuleError('nobody', 'No position with a profile is held.');
    }
    const profiles = new Map((await listProfiles(db)).map((p) => [p.profileId, p]));
    const reach = { sent: 0, relayed: 0, unreached: 0 };
    for (const holder of holders) {
      const profile = profiles.get(holder.profileId);
      if (!profile) continue;
      const managerPersonId = await managerOfPosition(db, asOf, holder.personId, holder.positionId);
      const reviewId = await insertReview(db, organizationId, {
        quarterId: quarter.quarterId,
        ...holder,
        managerPersonId,
        profile,
      });
      // The grid is notified in writing before it applies (rule 5.1).
      const outcome = await sendReviewLink(
        db,
        organizationId,
        { reviewId, personId: holder.personId, profileTitle: profile.title, managerPersonId },
        quarter,
        'grid',
        input.relayEmail,
      );
      reach[outcome] += 1;
    }
    await setQuarterStatus(db, quarter.quarterId, 'open');
    return { quarterId: quarter.quarterId, reviews: holders.length, ...reach };
  },
  summarize: (input) => `Quarter ${input.quarterId} opened, grids frozen and notified`,
});

/** The line's colour and the review's provisional factors, recomputed after each measure. */
async function recompute(db: SqlExecutor, review: Review, quarter: Quarter) {
  const lines = review.lines.map((l) => ({ ...l, colour: l.colour }));
  const individual = individualOf(lines, quarter.scale ?? defaultScale, quarter.progressive);
  let collective: number | null = null;
  for (const unitId of await unitsUpward(db, review.unitId)) {
    const found = quarter.units.find((u) => u.unitId === unitId);
    if (found) {
      collective = found.factor;
      break;
    }
  }
  const factor = factorOf(
    review.weights,
    { individual: individual.individual, collective, group: quarter.groupFactor },
    quarter.groupTriggered,
  );
  await updateReview(db, review.reviewId, {
    individual: individual.individual,
    collective,
    group: quarter.groupFactor,
    factor,
  });
  return { ...individual, collective, group: quarter.groupFactor, factor };
}

async function measurable(db: SqlExecutor, reviewId: string) {
  const review = await findReview(db, reviewId, true);
  if (!review) notFound('The review');
  const quarter = await findQuarter(db, review.quarterId);
  if (!quarter) notFound('The quarter');
  // Measures are entered while the quarter runs and until they are closed.
  if (quarter.status !== 'open' || review.status !== 'open') {
    throw new PerformanceRuleError('not_open', 'The measures of this quarter are closed.');
  }
  return { review, quarter };
}

export const recordMeasure = defineCommand({
  name: 'record-measure',
  input: measureInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const { review, quarter } = await measurable(db, input.reviewId);
    for (const entry of input.lines) {
      const line = review.lines.find((l) => l.position === entry.position);
      if (!line) notFound(`Line ${entry.position}`);
      const colour: Colour | null =
        line.kind === 'malus' ? null : colourOf(line, entry.value, entry.colour ?? null);
      await writeLine(db, review.reviewId, entry.position, {
        value: entry.value,
        colour,
        proof: entry.proof ?? null,
      });
      line.value = entry.value;
      line.colour = colour;
    }
    return { reviewId: review.reviewId, ...(await recompute(db, review, quarter)) };
  },
  summarize: (input) => `Review ${input.reviewId}: ${input.lines.length} measure(s)`,
});

export const measureFromSurvey = defineCommand({
  name: 'measure-from-survey',
  input: fromSurveyInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const { review, quarter } = await measurable(db, input.reviewId);
    const line = review.lines.find((l) => l.position === input.position);
    if (!line) notFound(`Line ${input.position}`);
    const scores = await surveyScores(db, input.campaignId);
    if (!scores) {
      throw new PerformanceRuleError('not_measured', 'That survey has no published results.');
    }
    // The section about the person's unit or the nearest unit above it; else the whole survey.
    const upward = await unitsUpward(db, review.unitId);
    const section =
      upward
        .map((unitId) => scores.results.sections.find((s) => s.unitId === unitId))
        .find(Boolean) ?? null;
    const group = section ?? scores.results.overall;
    const value = group.score;
    const colour = colourOf(line, value);
    await writeLine(db, review.reviewId, line.position, {
      value,
      colour,
      proof: `${scores.title} (${scores.period}) — ${section ? section.title : 'ensemble'}, ${group.count} réponses`,
    });
    line.value = value;
    line.colour = colour;
    return { reviewId: review.reviewId, value, ...(await recompute(db, review, quarter)) };
  },
  summarize: (input) => `Review ${input.reviewId}, line ${input.position}: from a survey`,
});

export const setCollectiveFactor = defineCommand({
  name: 'set-collective-factor',
  input: collectiveFactorInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const quarter = await findQuarter(db, input.quarterId);
    if (!quarter) notFound('The quarter');
    await setUnitFactor(db, organizationId, input).catch((error: { code?: string }) => {
      if (error.code === '23503') notFound('The unit');
      throw error;
    });
    return input;
  },
  summarize: (input) => `Quarter ${input.quarterId}: collective factor of ${input.unitId}`,
});

export const setGroupFactor = defineCommand({
  name: 'set-group-factor',
  input: groupFactorInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const quarter = await findQuarter(db, input.quarterId);
    if (!quarter) notFound('The quarter');
    await setGroup(db, input);
    return input;
  },
  summarize: (input) => `Quarter ${input.quarterId}: group factor set`,
});

/**
 * Closes the quarter's measures (the « arrêté »): a line with no value is red — charged to the
 * management — and every review's colours and factors are computed.
 */
export const closeMeasures = defineCommand({
  name: 'close-measures',
  input: quarterGestureInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const quarter = await findQuarter(db, input.quarterId, true);
    if (!quarter) notFound('The quarter');
    if (quarter.status !== 'open') throw new PerformanceRuleError('not_open', 'It is not open.');
    const reviews = await listReviews(db, { quarterId: quarter.quarterId }, true);
    let missing = 0;
    let plans = 0;
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    for (const review of reviews) {
      for (const line of review.lines) {
        if (line.kind === 'malus' || line.colour) continue;
        missing += 1;
        await writeLine(db, review.reviewId, line.position, {
          value: line.value,
          colour: 'red',
          proof: line.proof,
        });
        line.colour = 'red';
      }
      await recompute(db, review, quarter);
      if (review.status === 'open') await updateReview(db, review.reviewId, { status: 'measured' });
      // Orange calls for an action plan, red for a corrective action (§ 1.5): one plan per review,
      // owned by the person's manager, in the register (spec 013).
      const reds = review.lines.filter((l) => l.kind !== 'malus' && l.colour === 'red');
      const oranges = review.lines.filter((l) => l.kind !== 'malus' && l.colour === 'orange');
      if (reds.length + oranges.length > 0) {
        await openAction(db, organizationId, {
          title: `${quarter.label} — ${review.personName} : ${reds.length} rouge(s), ${oranges.length} orange(s)`,
          detail: [...reds, ...oranges]
            .map((l) => `${l.colour === 'red' ? '●' : '○'} ${l.name}`)
            .join('\n'),
          source: 'indicator',
          sourceRef: review.reviewId,
          responsiblePersonId: review.managerPersonId ?? review.personId,
          dueOn: due,
        });
        plans += 1;
      }
    }
    await setQuarterStatus(db, quarter.quarterId, 'measured');
    return { quarterId: quarter.quarterId, reviews: reviews.length, missing, plans };
  },
  summarize: (input) => `Quarter ${input.quarterId}: measures closed`,
});

// ---------------------------------------------------------------- the review itself

/** Who acts on a review: set by the API from the account or the link, never by the caller. */
const acting = z.object({
  actingPersonId: z.string().regex(/^prs_[0-9a-f-]{8,64}$/),
  /** The person holds a performance right that lets her act as reviewer. */
  manages: z.boolean().default(false),
  relayEmail: z.email().nullable().default(null),
});

export const acknowledgeGrid = defineCommand({
  name: 'acknowledge-grid',
  input: reviewGestureInput.extend(acting.shape),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const review = await findReview(db, input.reviewId, true);
    if (!review) notFound('The review');
    if (review.personId !== input.actingPersonId) {
      throw new PerformanceRuleError('not_yours', 'Only the person acknowledges her grid.');
    }
    await updateReview(db, review.reviewId, { acknowledged: true });
    return { reviewId: review.reviewId };
  },
  summarize: (input) => `Review ${input.reviewId}: grid acknowledged`,
});

export const writeRecord = defineCommand({
  name: 'write-review',
  input: recordInput.extend(acting.shape),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const review = await findReview(db, input.reviewId, true);
    if (!review) notFound('The review');
    if (review.managerPersonId !== input.actingPersonId && !input.manages) {
      throw new PerformanceRuleError('not_reviewer', 'Only her manager writes this review.');
    }
    if (review.status !== 'measured') {
      throw new PerformanceRuleError(
        'wrong_step',
        'The record is written once the measures are closed.',
      );
    }
    await updateReview(db, review.reviewId, {
      record: {
        facts: input.facts,
        difficulties: input.difficulties,
        support: input.support,
        protocols: input.protocols,
      },
    });
    return { reviewId: review.reviewId };
  },
  summarize: (input) => `Review ${input.reviewId}: record written`,
  journalInput: false,
});

/**
 * Signs a review: first the manager (then the person is told, by link), then the person, who may add
 * her observations. Both signatures are dated and journaled; a review signed by both is the written
 * record rule 3.4 asks for.
 */
export const signReview = defineCommand({
  name: 'sign-review',
  input: signInput.extend(acting.shape),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const review = await findReview(db, input.reviewId, true);
    if (!review) notFound('The review');
    if (review.status === 'measured') {
      if (review.managerPersonId !== input.actingPersonId && !input.manages) {
        throw new PerformanceRuleError('not_reviewer', 'Her manager signs first.');
      }
      await updateReview(db, review.reviewId, {
        status: 'manager_signed',
        managerSignedBy: input.actingPersonId,
      });
      const quarter = await findQuarter(db, review.quarterId);
      if (quarter) {
        await sendReviewLink(db, organizationId, review, quarter, 'record', input.relayEmail);
      }
      return { reviewId: review.reviewId, status: 'manager_signed' };
    }
    if (review.status === 'manager_signed') {
      if (review.personId !== input.actingPersonId) {
        throw new PerformanceRuleError('not_yours', 'Only the person signs her review now.');
      }
      await updateReview(db, review.reviewId, {
        status: 'signed',
        personSigned: true,
        personObservations: input.observations ?? null,
      });
      return { reviewId: review.reviewId, status: 'signed' };
    }
    throw new PerformanceRuleError('wrong_step', 'This review cannot be signed now.');
  },
  summarize: (input) => `Review ${input.reviewId} signed`,
  journalInput: false,
});

export const validateReview = defineCommand({
  name: 'validate-review',
  input: reviewGestureInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const review = await findReview(db, input.reviewId, true);
    if (!review) notFound('The review');
    if (review.status !== 'signed') {
      throw new PerformanceRuleError('wrong_step', 'Only a review signed by both is validated.');
    }
    const quarter = await findQuarter(db, review.quarterId);
    if (!quarter) notFound('The quarter');
    const factors = await recompute(db, review, quarter);
    await updateReview(db, review.reviewId, { status: 'validated', validatedBy: actor.id });
    return { reviewId: review.reviewId, factor: factors.factor };
  },
  summarize: (input) => `Review ${input.reviewId} validated`,
});

/**
 * Closes the quarter: a review never held is not a reason not to pay — it gets the average of the
 * person's last two quarters, and is flagged as a failure of her management (rule 3.4).
 */
export const closeQuarter = defineCommand({
  name: 'close-quarter',
  input: quarterGestureInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const quarter = await findQuarter(db, input.quarterId, true);
    if (!quarter) notFound('The quarter');
    if (quarter.status !== 'measured') {
      throw new PerformanceRuleError('not_measured', 'Close the measures first.');
    }
    const reviews = await listReviews(db, { quarterId: quarter.quarterId });
    let missed = 0;
    for (const review of reviews) {
      if (review.status === 'validated') continue;
      const factor = fallbackOf(await previousFactors(db, review.personId, quarter.startsOn));
      await updateReview(db, review.reviewId, {
        status: 'missed',
        fallback: true,
        ...(factor !== null ? { factor } : {}),
      });
      missed += 1;
    }
    await setQuarterStatus(db, quarter.quarterId, 'closed');
    return { quarterId: quarter.quarterId, missed };
  },
  summarize: (input) => `Quarter ${input.quarterId} closed`,
});

export type { Scale };
