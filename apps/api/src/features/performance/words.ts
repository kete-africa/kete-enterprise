import type { Locale } from '../mail/index.js';

/** The words of the performance e-mails, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    gridSubject: (quarter: string) => `Vos indicateurs du ${quarter}`,
    grid: (quarter: string, title: string) =>
      `Voici vos indicateurs du ${quarter}, pour le poste « ${title} » : chacun avec sa formule, sa source, sa cible, son seuil d'alerte et son poids. Ils ne changeront pas pendant le trimestre. Merci d'en accuser réception.`,
    recordSubject: (quarter: string) => `Votre revue du ${quarter} : à signer`,
    record: (manager: string, quarter: string) =>
      `${manager} a rédigé et signé le compte rendu de votre revue du ${quarter}. Lisez-le, ajoutez vos observations si vous le souhaitez, et signez-le à votre tour.`,
    relaySubject: (name: string, quarter: string) =>
      `Lien de revue à transmettre à ${name} — ${quarter}`,
    relay: (name: string) =>
      `${name} n'a pas d'adresse e-mail dans l'organisation. Transmettez-lui ce lien personnel, par message ou en main propre : il n'ouvre que sa revue.`,
    greeting: (name: string) => `Bonjour ${name},`,
    relayGreeting: 'Bonjour,',
    action: 'Ouvrir ma revue',
    reason: 'Vous recevez ce message pour la revue trimestrielle de performance.',
    relayReason: 'Vous recevez ce message parce que vous suivez cette personne.',
  },
  en: {
    gridSubject: (quarter: string) => `Your indicators for ${quarter}`,
    grid: (quarter: string, title: string) =>
      `Here are your indicators for ${quarter}, for the position « ${title} »: each with its formula, source, target, alert threshold and weight. They will not change during the quarter. Please acknowledge them.`,
    recordSubject: (quarter: string) => `Your ${quarter} review: to sign`,
    record: (manager: string, quarter: string) =>
      `${manager} wrote and signed the record of your ${quarter} review. Read it, add your observations if you wish, and sign it in turn.`,
    relaySubject: (name: string, quarter: string) =>
      `Review link to pass on to ${name} — ${quarter}`,
    relay: (name: string) =>
      `${name} has no e-mail address in the organization. Pass this personal link on, by message or by hand: it opens only their review.`,
    greeting: (name: string) => `Hello ${name},`,
    relayGreeting: 'Hello,',
    action: 'Open my review',
    reason: 'You receive this message for the quarterly performance review.',
    relayReason: 'You receive this message because you follow this person.',
  },
} as const;

export function performanceWords(locale: Locale) {
  return catalog[locale];
}
