import type { Locale } from '../mail/index.js';

/** The words of the notifications, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    decisionWaiting: (title: string) => `Votre décision est attendue : ${title}`,
    decisionInformed: (title: string) => `Pour information : ${title}`,
    decisionReturned: (title: string, reason: string) =>
      `À corriger : ${title}${reason ? ` — ${reason}` : ''}`,
    routineHandedTo: (agent: string) => `Confié à ${agent}`,
    scheduleAnswered: (title: string) => `Votre tâche « ${title} » a répondu`,
    taskAdded: (source: string, title: string) => `${source} : ${title}`,
    agentSignal: (subject: string) => `Votre agent signale : ${subject}`,
    agentTaskDone: (agent: string) => `${agent} a terminé la tâche que vous lui avez confiée`,
    agentBudgetSpent: (agent: string) =>
      `Budget du mois atteint pour ${agent} : il attend. Relevez-le, ou demandez plus à l’administration.`,
    agentTaskTakenOver: (agent: string, instruction: string) =>
      `Repris à ${agent} : ${instruction}`,
    decisionComment: (author: string, title: string) => `${author} a écrit sur « ${title} »`,
    routineCrossed: (title: string, value: string, line: string, above: boolean) =>
      `« ${title} » est ${above ? 'au-dessus' : 'au-dessous'} de ${line} : ${value}`,
    exchangeAsked: (asker: string, question: string) =>
      `L’assistant de ${asker} vous demande : ${question}`,
    exchangeReplied: (colleague: string) => `${colleague} a répondu à votre assistant`,
    exchangeDeclined: (colleague: string) => `${colleague} ne répond pas à cette question`,
    requestReceived: (asker: string, title: string) => `${asker} vous demande : ${title}`,
    requestTaken: (colleague: string, title: string) =>
      `${colleague} a pris en charge « ${title} »`,
    requestWaiting: (colleague: string, title: string) =>
      `${colleague} a besoin de vous pour « ${title} »`,
    requestAnswered: (asker: string, title: string) => `${asker} a répondu sur « ${title} »`,
    requestReturned: (colleague: string, title: string) => `${colleague} vous a rendu « ${title} »`,
    requestDeclined: (colleague: string, title: string) => `${colleague} ne fera pas « ${title} »`,
    requestReminded: (asker: string, title: string) => `${asker} vous relance pour « ${title} »`,
    receptionHanded: (agent: string, word: string) => `${agent} — par sa règle « ${word} »`,
    ruleRefused: (sentence: string) => `Refusé par une règle de l’organisation : « ${sentence} »`,
    receptionAway: (delegate: string, until: string) =>
      `Absence jusqu’au ${until} : cette demande va à ${delegate}.`,
    holdingTakenOver: (absent: string, what: string) =>
      `Vous tenez « ${what} » pendant l’absence de ${absent}`,
    holdingReclaimed: (what: string) => `« ${what} » n’avait plus personne : vous le tenez`,
    holdingHandedBack: (colleague: string, what: string, reason: string) =>
      `${colleague} vous rend « ${what} » : ${reason}`,
    holdingStuck: (what: string) => `Personne ne peut tenir « ${what} » : à confier`,
    holdingNudge: (what: string) => `On attend votre réponse : « ${what} »`,
    holdingNudgeParty: (what: string) => `À relancer : « ${what} »`,
    draftToCheck: (what: string) => `Brouillon à valider : ${what}`,
  },
  en: {
    decisionWaiting: (title: string) => `Your decision is awaited: ${title}`,
    decisionInformed: (title: string) => `For your information: ${title}`,
    decisionReturned: (title: string, reason: string) =>
      `To correct: ${title}${reason ? ` — ${reason}` : ''}`,
    routineHandedTo: (agent: string) => `Handed to ${agent}`,
    scheduleAnswered: (title: string) => `Your task « ${title} » answered`,
    taskAdded: (source: string, title: string) => `${source}: ${title}`,
    agentSignal: (subject: string) => `Your agent reports: ${subject}`,
    agentTaskDone: (agent: string) => `${agent} finished the task you gave it`,
    agentBudgetSpent: (agent: string) =>
      `${agent} spent its budget for the month: it waits. Raise it, or ask the administration for more.`,
    agentTaskTakenOver: (agent: string, instruction: string) =>
      `Taken over from ${agent}: ${instruction}`,
    decisionComment: (author: string, title: string) => `${author} wrote on “${title}”`,
    routineCrossed: (title: string, value: string, line: string, above: boolean) =>
      `“${title}” is ${above ? 'above' : 'below'} ${line}: ${value}`,
    exchangeAsked: (asker: string, question: string) =>
      `${asker}’s assistant asks you: ${question}`,
    exchangeReplied: (colleague: string) => `${colleague} answered your assistant`,
    exchangeDeclined: (colleague: string) => `${colleague} does not answer this question`,
    requestReceived: (asker: string, title: string) => `${asker} asks you: ${title}`,
    requestTaken: (colleague: string, title: string) => `${colleague} took on “${title}”`,
    requestWaiting: (colleague: string, title: string) => `${colleague} needs you for “${title}”`,
    requestAnswered: (asker: string, title: string) => `${asker} answered on “${title}”`,
    requestReturned: (colleague: string, title: string) =>
      `${colleague} returned “${title}” to you`,
    requestDeclined: (colleague: string, title: string) => `${colleague} will not do “${title}”`,
    requestReminded: (asker: string, title: string) => `${asker} reminds you of “${title}”`,
    receptionHanded: (agent: string, word: string) => `${agent} — by their rule “${word}”`,
    ruleRefused: (sentence: string) => `Refused by a rule of the organization: “${sentence}”`,
    receptionAway: (delegate: string, until: string) =>
      `Away until ${until}: this request goes to ${delegate}.`,
    holdingTakenOver: (absent: string, what: string) =>
      `You hold “${what}” while ${absent} is away`,
    holdingReclaimed: (what: string) => `“${what}” had nobody left: you hold it`,
    holdingHandedBack: (colleague: string, what: string, reason: string) =>
      `${colleague} hands “${what}” back to you: ${reason}`,
    holdingStuck: (what: string) => `Nobody can hold “${what}”: to entrust`,
    holdingNudge: (what: string) => `Your answer is awaited: “${what}”`,
    holdingNudgeParty: (what: string) => `To follow up: “${what}”`,
    draftToCheck: (what: string) => `Draft to check: ${what}`,
  },
} as const;

export function notificationWords(locale: Locale = 'fr') {
  return catalog[locale];
}
