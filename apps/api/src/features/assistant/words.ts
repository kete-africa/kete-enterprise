import type { Locale } from '../mail/index.js';

/** The words of the briefing written by rules, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    hello: (name: string) => `Bonjour ${name}.`,
    decisions: (n: number) => `${n} décision(s) attendent votre validation.`,
    overdue: (n: number, first: string) => `${n} action(s) en retard, dont « ${first} ».`,
    forms: (n: number, closes: string) => `${n} formulaire(s) à remplir, avant le ${closes}.`,
    notes: (n: number) => `${n} note(s) de décision à lire.`,
    reds: (n: number, which: string) => `${n} de vos indicateurs sont au rouge : ${which}.`,
    team: (n: number) => `${n} personne(s) de votre équipe ont des indicateurs au rouge.`,
    toWrite: (n: number) => `${n} compte(s) rendu(s) de revue à rédiger pour votre équipe.`,
    appNews: (app: string, n: number, what: string) => `${app} : ${what} (${n} depuis hier).`,
    nothing: 'Rien ne presse ce matin.',
  },
  en: {
    hello: (name: string) => `Good morning ${name}.`,
    decisions: (n: number) => `${n} decision(s) wait for your approval.`,
    overdue: (n: number, first: string) => `${n} overdue action(s), including « ${first} ».`,
    forms: (n: number, closes: string) => `${n} form(s) to fill in, before ${closes}.`,
    notes: (n: number) => `${n} decision note(s) to read.`,
    reds: (n: number, which: string) => `${n} of your indicators are red: ${which}.`,
    team: (n: number) => `${n} person(s) of your team have indicators in red.`,
    toWrite: (n: number) => `${n} review record(s) to write for your team.`,
    appNews: (app: string, n: number, what: string) => `${app}: ${what} (${n} since yesterday).`,
    nothing: 'Nothing urgent this morning.',
  },
} as const;

export function assistantWords(locale: Locale) {
  return catalog[locale];
}
