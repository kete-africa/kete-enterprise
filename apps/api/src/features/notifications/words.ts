import type { Locale } from '../mail/index.js';

/** The words of the notifications, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    decisionWaiting: (title: string) => `Votre décision est attendue : ${title}`,
    scheduleAnswered: (title: string) => `Votre tâche « ${title} » a répondu`,
    taskAdded: (source: string, title: string) => `${source} : ${title}`,
    agentSignal: (subject: string) => `Votre agent signale : ${subject}`,
    agentTaskDone: (agent: string) => `${agent} a terminé la tâche que vous lui avez confiée`,
    decisionComment: (author: string, title: string) => `${author} a écrit sur « ${title} »`,
  },
  en: {
    decisionWaiting: (title: string) => `Your decision is awaited: ${title}`,
    scheduleAnswered: (title: string) => `Your task « ${title} » answered`,
    taskAdded: (source: string, title: string) => `${source}: ${title}`,
    agentSignal: (subject: string) => `Your agent reports: ${subject}`,
    agentTaskDone: (agent: string) => `${agent} finished the task you gave it`,
    decisionComment: (author: string, title: string) => `${author} wrote on “${title}”`,
  },
} as const;

export function notificationWords(locale: Locale = 'fr') {
  return catalog[locale];
}
