import type { Locale } from '../mail/index.js';

/** The words of the notifications, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    decisionWaiting: (title: string) => `Votre décision est attendue : ${title}`,
    scheduleAnswered: (title: string) => `Votre tâche « ${title} » a répondu`,
    taskAdded: (source: string, title: string) => `${source} : ${title}`,
    agentSignal: (subject: string) => `Votre agent signale : ${subject}`,
  },
  en: {
    decisionWaiting: (title: string) => `Your decision is awaited: ${title}`,
    scheduleAnswered: (title: string) => `Your task « ${title} » answered`,
    taskAdded: (source: string, title: string) => `${source}: ${title}`,
    agentSignal: (subject: string) => `Your agent reports: ${subject}`,
  },
} as const;

export function notificationWords(locale: Locale = 'fr') {
  return catalog[locale];
}
