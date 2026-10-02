/**
 * The arithmetic of the quarterly review (spec 012), with no database: colours, points and factors
 * as KYA-KPI-01 § 1.5–1.6 and the IT workbook define them. Two people applying it to the same values
 * find the same numbers.
 */

export type Colour = 'green' | 'orange' | 'red';
export type LineKind = 'scored' | 'penalizing' | 'blocking' | 'malus';
export type Comparison = '<' | '<=' | '>' | '>=';

export interface Scale {
  green: number;
  orange: number;
  red: number;
}

/** Green earns the whole weight, orange 60 %, red nothing (the workbook's scale, adjustable). */
export const defaultScale: Scale = { green: 1, orange: 0.6, red: 0 };

/** The penalty coefficient by number of incidents: none 1, one 0.5, two or more 0. */
export const defaultMalus = [
  { upTo: 0, coefficient: 1 },
  { upTo: 1, coefficient: 0.5 },
  { upTo: null, coefficient: 0 },
];
export type Malus = { upTo: number | null; coefficient: number }[];

export interface LineRule {
  direction: 'higher' | 'lower' | null;
  target: number | null;
  threshold: number | null;
  /** How the value compares to the threshold when the line turns red. */
  alertWhen: Comparison | null;
}

const compare = (value: number, op: Comparison, other: number) =>
  op === '<'
    ? value < other
    : op === '<='
      ? value <= other
      : op === '>'
        ? value > other
        : value >= other;

/**
 * The colour a value earns. No value is red — a failure of whoever had to produce it. A line whose
 * target is words has no computed colour: whoever measures chooses it (`chosen`).
 */
export function colourOf(
  rule: LineRule,
  value: number | null,
  chosen?: Colour | null,
): Colour | null {
  if (value === null) return rule.direction ? 'red' : (chosen ?? 'red');
  if (!rule.direction || rule.target === null || rule.threshold === null || !rule.alertWhen) {
    return chosen ?? null;
  }
  const met = rule.direction === 'higher' ? value >= rule.target : value <= rule.target;
  if (met) return 'green';
  return compare(value, rule.alertWhen, rule.threshold) ? 'red' : 'orange';
}

export function malusOf(steps: Malus, incidents: number | null): number {
  // No register kept counts as one incident: the IT workbook's 0.5.
  const count = incidents ?? 1;
  for (const step of steps) if (step.upTo === null || count <= step.upTo) return step.coefficient;
  return 0;
}

export interface ReviewLine extends LineRule {
  weight: number | null;
  kind: LineKind;
  reliable: boolean;
  value: number | null;
  colour: Colour | null;
  malus: Malus | null;
}

export interface Individual {
  /** Points earned over the counted weight, before the penalty: 0 to 1. */
  base: number;
  penalty: number;
  /** A blocking line in red sets the factor to 0. */
  blocked: boolean;
  individual: number;
  /** Lines left out by progressivity: shown, not counted. */
  observed: number;
}

/**
 * The individual factor: the points of the counted lines over their weight (renormalised when
 * progressivity leaves unreliable ones out), times the penalty coefficients, or 0 when a blocking
 * line is red.
 */
export function individualOf(lines: ReviewLine[], scale: Scale, progressive: boolean): Individual {
  let weight = 0;
  let points = 0;
  let observed = 0;
  let penalty = 1;
  let blocked = false;
  for (const line of lines) {
    if (line.kind === 'malus') {
      penalty *= malusOf(line.malus ?? defaultMalus, line.value);
      continue;
    }
    if (line.weight === null) continue;
    if (progressive && !line.reliable) {
      observed += 1;
      continue;
    }
    const colour = line.colour ?? 'red';
    weight += line.weight;
    points += line.weight * scale[colour];
    if (line.kind === 'blocking' && colour === 'red') blocked = true;
  }
  const base = weight > 0 ? points / weight : 0;
  const individual = blocked ? 0 : base * penalty;
  return { base: round(base), penalty, blocked, individual: round(individual), observed };
}

export interface Split {
  individual: number;
  collective: number;
  group: number;
}

/**
 * The quarter's factor: individual, collective (the direction, agency or service) and group, each by
 * its weight on the position. Without the group's trigger, nothing is due this quarter.
 */
export function factorOf(
  split: Split,
  parts: { individual: number; collective: number | null; group: number | null },
  triggered: boolean,
): number {
  if (!triggered) return 0;
  const total =
    split.individual * parts.individual +
    split.collective * (parts.collective ?? 0) +
    split.group * (parts.group ?? 0);
  return round(total);
}

/** Without a review, the average of the last two quarters' factors (rule 3.4). */
export function fallbackOf(previous: number[]): number | null {
  const last = previous.slice(0, 2);
  if (last.length === 0) return null;
  return round(last.reduce((s, f) => s + f, 0) / last.length);
}

export const round = (value: number) => Math.round(value * 10000) / 10000;
