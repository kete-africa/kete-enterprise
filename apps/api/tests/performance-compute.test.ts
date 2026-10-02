import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  colourOf,
  defaultScale,
  factorOf,
  fallbackOf,
  individualOf,
  profileInput,
  type ReviewLine,
} from '../src/features/performance/index.js';

// Spec 012: the arithmetic of the review, as KYA-KPI-01 and the IT workbook define it.

const line = (over: Partial<ReviewLine>): ReviewLine => ({
  direction: 'higher',
  target: 95,
  threshold: 80,
  alertWhen: '<',
  weight: 0.25,
  kind: 'scored',
  reliable: true,
  value: null,
  colour: null,
  malus: null,
  ...over,
});

describe('colours', () => {
  it('green at the target, orange before the threshold, red past it — and red without a value', () => {
    const rule = line({});
    expect(colourOf(rule, 95)).toBe('green');
    expect(colourOf(rule, 80)).toBe('orange');
    expect(colourOf(rule, 79.9)).toBe('red');
    expect(colourOf(rule, null)).toBe('red');
  });

  it('reads « lower is better » and thresholds that include their value', () => {
    const delay = line({ direction: 'lower', target: 7, threshold: 12, alertWhen: '>' });
    expect(colourOf(delay, 6)).toBe('green');
    expect(colourOf(delay, 12)).toBe('orange');
    expect(colourOf(delay, 13)).toBe('red');
    // « 0 séance sur le trimestre » is the alert itself.
    const sessions = line({ target: 1, threshold: 0, alertWhen: '<=' });
    expect(colourOf(sessions, 0)).toBe('red');
    expect(colourOf(sessions, 3)).toBe('green');
  });

  it('leaves a target in words to whoever measures', () => {
    const words = line({ direction: null, target: null, threshold: null, alertWhen: null });
    expect(colourOf(words, 1)).toBeNull();
    expect(colourOf(words, 1, 'orange')).toBe('orange');
  });
});

describe('factors', () => {
  it('weights points by colour, then the penalty coefficient', () => {
    // The IT head's grid: 40 % green, 30 % orange, 30 % red, one incident with a loss.
    const lines = [
      line({ weight: 0.4, colour: 'green' }),
      line({ weight: 0.3, colour: 'orange' }),
      line({ weight: 0.3, colour: 'red' }),
      line({ weight: null, kind: 'malus', value: 1 }),
    ];
    const result = individualOf(lines, defaultScale, false);
    expect(result.base).toBe(0.58);
    expect(result.penalty).toBe(0.5);
    expect(result.individual).toBe(0.29);
  });

  it('counts only reliable sources under progressivity, renormalising their weights', () => {
    const lines = [
      line({ weight: 0.5, colour: 'green' }),
      line({ weight: 0.5, colour: 'red', reliable: false }),
    ];
    expect(individualOf(lines, defaultScale, true)).toMatchObject({ individual: 1, observed: 1 });
    expect(individualOf(lines, defaultScale, false).individual).toBe(0.5);
  });

  it('sets the factor to 0 when a blocking line is red', () => {
    const lines = [
      line({ weight: 0.86, colour: 'green' }),
      line({ weight: 0.14, kind: 'blocking', colour: 'red' }),
    ];
    expect(individualOf(lines, defaultScale, false)).toMatchObject({
      blocked: true,
      individual: 0,
    });
  });

  it('combines individual, collective and group, and pays nothing without the trigger', () => {
    const split = { individual: 0.7, collective: 0.2, group: 0.1 };
    expect(factorOf(split, { individual: 0.7, collective: 0.8, group: 0.9 }, true)).toBe(0.74);
    expect(factorOf(split, { individual: 0.7, collective: 0.8, group: 0.9 }, false)).toBe(0);
  });

  it('falls back on the average of the last two quarters', () => {
    expect(fallbackOf([0.8, 0.6, 0.1])).toBe(0.7);
    expect(fallbackOf([])).toBeNull();
  });
});

describe('the KYA referential', () => {
  it('holds 48 profiles, each valid, whose weights make 100 %', () => {
    const referential = JSON.parse(
      readFileSync(new URL('../db/demo/kya-kpi.json', import.meta.url), 'utf8'),
    ) as { profiles: unknown[] };
    expect(referential.profiles).toHaveLength(48);
    for (const raw of referential.profiles) {
      const profile = profileInput.parse(raw);
      const sum = profile.lines
        .filter((l) => l.kind !== 'malus')
        .reduce((s, l) => s + (l.weight ?? 0), 0);
      expect(Math.abs(sum - 1)).toBeLessThan(0.011);
    }
  });
});
