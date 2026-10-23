import type { Locale } from '../mail/index.js';

/** The words of the event path, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    /** A line in the object's thread: what the app said happened. */
    happened: (app: string, what: string) => `${app} · ${what}`,
    /** What an agent is asked when an event it follows happens. */
    toAgent: (what: string, title: string, details: string) =>
      `Un événement que vous suivez vient d’arriver : ${what}${title ? ` — « ${title} »` : ''}.${details ? ` ${details}` : ''} Regardez ce qu’il demande et proposez la suite, sans rien engager seul.`,
    stateChanged: (from: string, to: string) => `État : ${from} → ${to}.`,
    created: 'Il vient d’apparaître.',
  },
  en: {
    happened: (app: string, what: string) => `${app} · ${what}`,
    toAgent: (what: string, title: string, details: string) =>
      `An event you follow has just happened: ${what}${title ? ` — “${title}”` : ''}.${details ? ` ${details}` : ''} See what it asks and propose what follows, committing nothing alone.`,
    stateChanged: (from: string, to: string) => `State: ${from} → ${to}.`,
    created: 'It has just appeared.',
  },
};

export function eventWords(locale: Locale = 'fr') {
  return catalog[locale];
}
