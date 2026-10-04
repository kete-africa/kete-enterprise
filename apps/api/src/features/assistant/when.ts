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

/** The parts of an instant as a wall clock in a time zone shows them. */
function wallClock(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
    weekday: weekdays.indexOf(parts['weekday'] ?? '') + 1,
  };
}

/** The instant a wall-clock time shows in a time zone (its offset read at that instant). */
function instantOf(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const shown = wallClock(new Date(guess), timeZone);
  const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - guess;
  return new Date(guess - offset);
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

/** The first instant strictly after `after` when the schedule runs. */
export function nextRun(when: When, after: Date): Date {
  const [hour, minute] = when.time.split(':').map(Number) as [number, number];
  const today = wallClock(after, when.timeZone);
  for (let days = 0; days <= 8; days++) {
    const noon = new Date(Date.UTC(today.year, today.month - 1, today.day + days, 12));
    const date = {
      year: noon.getUTCFullYear(),
      month: noon.getUTCMonth() + 1,
      day: noon.getUTCDate(),
    };
    const weekday = ((today.weekday - 1 + days) % 7) + 1;
    if (when.cadence === 'weekdays' && weekday > 5) continue;
    if (when.cadence === 'weekly' && weekday !== when.weekday) continue;
    const at = instantOf(date, hour, minute, when.timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('No next run within a week.');
}
