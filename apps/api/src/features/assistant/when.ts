import { Cron } from 'croner';

// When a schedule runs next (spec 029): a time of day in the person's time zone, every day, on
// weekdays, or on one day of the week. Pure: no clock but the one given.

export type Cadence = 'daily' | 'weekdays' | 'weekly';

export interface When {
  cadence: Cadence;
  /** For `weekly`: 1 (Monday) to 7 (Sunday). */
  weekday: number | null;
  /** `HH:MM`, in `timeZone`. */
  time: string;
  /** An IANA time zone, e.g. `Africa/Lome`. */
  timeZone: string;
}

/** Whether a time zone is one the runtime knows. */
export function knownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The schedule as a cron pattern: its minute, its hour, and the days it runs (0 is Sunday). */
function patternOf(when: When): string {
  const [hour, minute] = when.time.split(':').map(Number) as [number, number];
  const days =
    when.cadence === 'daily'
      ? '*'
      : when.cadence === 'weekdays'
        ? '1-5'
        : String((when.weekday ?? 1) % 7);
  return `${minute} ${hour} * * ${days}`;
}

/**
 * The first instant strictly after `after` when the schedule runs, in its time zone — computed by
 * croner, daylight saving included.
 */
export function nextRun(when: When, after: Date): Date {
  const next = new Cron(patternOf(when), { timezone: when.timeZone }).nextRun(after);
  if (!next) throw new Error('No next run.');
  return next;
}
