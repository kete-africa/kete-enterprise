import type { Locale } from '../mail/index.js';

/** The words of threads and channels in the center, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    keteThread: 'Kete',
    received: 'Message reçu, merci. Nous revenons vers vous.',
    noted: 'C’est noté dans votre fil Kete.',
    outsider: 'Quelqu’un hors de l’organisation',
    mentioned: (who: string, thread: string) => `${who} vous mentionne dans « ${thread} »`,
    forYou: (who: string, thread: string) => `${who} vous demande d’agir dans « ${thread} »`,
    toApprove: (who: string, thread: string) =>
      `${who} veut écrire au client dans « ${thread} » : votre accord`,
    keteSilent:
      'Kete n’a pas pu répondre : aucun modèle n’est configuré, ou son budget est épuisé.',
    digestSubject: (count: number) => `${count} fil(s) avec du non-lu`,
    digestIntro: 'Ce qui vous attend dans vos fils Kete :',
    digestLine: (thread: string, unread: number) => `${thread} — ${unread} message(s) non lu(s)`,
    digestOpen: 'Ouvrir mes fils',
  },
  en: {
    keteThread: 'Kete',
    received: 'Message received, thank you. We will come back to you.',
    noted: 'Noted in your Kete thread.',
    outsider: 'Someone outside the organization',
    mentioned: (who: string, thread: string) => `${who} mentions you in “${thread}”`,
    forYou: (who: string, thread: string) => `${who} asks you to act in “${thread}”`,
    toApprove: (who: string, thread: string) =>
      `${who} wants to write to the client in “${thread}”: your approval`,
    keteSilent: 'Kete could not answer: no model is set, or its budget is spent.',
    digestSubject: (count: number) => `${count} thread(s) with unread messages`,
    digestIntro: 'What waits for you in your Kete threads:',
    digestLine: (thread: string, unread: number) => `${thread} — ${unread} unread message(s)`,
    digestOpen: 'Open my threads',
  },
} as const;

export function messageWords(locale: Locale = 'fr') {
  return catalog[locale];
}
