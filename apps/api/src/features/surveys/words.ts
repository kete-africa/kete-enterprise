import type { Locale } from '../mail/index.js';

/** The words of the surveys' e-mails, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    inviteSubject: (title: string) => `${title} : votre avis`,
    reminderSubject: (title: string) => `Rappel — ${title}`,
    relaySubject: (name: string, title: string) => `Lien à transmettre à ${name} — ${title}`,
    greeting: (name: string) => `Bonjour ${name},`,
    relayGreeting: 'Bonjour,',
    invite: (title: string, period: string, closes: string) =>
      `Vous êtes invité(e) à répondre à « ${title} » (${period}), avant le ${closes}. Cela prend quelques minutes, depuis un téléphone ou un ordinateur, sans compte.`,
    reminder: (title: string, closes: string) =>
      `Votre réponse à « ${title} » est attendue avant le ${closes}. Ce nouveau lien remplace le précédent.`,
    anonymous:
      'Vos réponses sont anonymes : une fois envoyées, elles ne sont plus reliées à votre nom.',
    named: 'Vos réponses sont nominatives.',
    relay: (name: string) =>
      `${name} n'a pas d'adresse e-mail dans l'organisation. Transmettez-lui ce lien personnel, par message ou en main propre : il ne s'ouvre que pour ses formulaires.`,
    action: 'Répondre',
    reason: 'Vous recevez ce message parce que vous faites partie des personnes interrogées.',
    relayReason: 'Vous recevez ce message parce que vous avez lancé cette enquête.',
  },
  en: {
    inviteSubject: (title: string) => `${title}: your view`,
    reminderSubject: (title: string) => `Reminder — ${title}`,
    relaySubject: (name: string, title: string) => `Link to pass on to ${name} — ${title}`,
    greeting: (name: string) => `Hello ${name},`,
    relayGreeting: 'Hello,',
    invite: (title: string, period: string, closes: string) =>
      `You are invited to answer « ${title} » (${period}), before ${closes}. It takes a few minutes, from a phone or a computer, without an account.`,
    reminder: (title: string, closes: string) =>
      `Your answer to « ${title} » is expected before ${closes}. This new link replaces the previous one.`,
    anonymous: 'Your answers are anonymous: once sent, they are no longer tied to your name.',
    named: 'Your answers carry your name.',
    relay: (name: string) =>
      `${name} has no e-mail address in the organization. Pass this personal link on, by message or by hand: it opens only their forms.`,
    action: 'Answer',
    reason: 'You receive this message because you are among the people surveyed.',
    relayReason: 'You receive this message because you launched this survey.',
  },
} as const;

export function surveyWords(locale: Locale) {
  return catalog[locale];
}
