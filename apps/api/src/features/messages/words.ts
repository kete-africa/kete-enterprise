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
    keteFailed: 'Kete n’a pas pu joindre le modèle. Réessayez dans un moment.',
    digestSubject: (count: number) => `${count} fil(s) avec du non-lu`,
    digestIntro: 'Ce qui vous attend dans vos fils Kete :',
    digestLine: (thread: string, unread: number) => `${thread} — ${unread} message(s) non lu(s)`,
    digestOpen: 'Ouvrir mes fils',
    keteRead: (sources: number) => `A lu ${sources} source${sources > 1 ? 's' : ''}`,
    readThread: 'Lire ce fil et l’état de son objet',
    levelRead: 'lire',
    pushed: (who: string, thread: string) => `${who} dans « ${thread} »`,
    voiceNote: 'Vocal',
    returned: (who: string, what: string) => `${who} vous rend « ${what} » : c’est fait`,
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
    keteFailed: 'Kete could not reach the model. Try again in a moment.',
    digestSubject: (count: number) => `${count} thread(s) with unread messages`,
    digestIntro: 'What waits for you in your Kete threads:',
    digestLine: (thread: string, unread: number) => `${thread} — ${unread} unread message(s)`,
    digestOpen: 'Open my threads',
    keteRead: (sources: number) => `Read ${sources} source${sources > 1 ? 's' : ''}`,
    readThread: 'Read this thread and its object’s state',
    levelRead: 'read',
    pushed: (who: string, thread: string) => `${who} in “${thread}”`,
    voiceNote: 'Voice note',
    returned: (who: string, what: string) => `${who} returns “${what}” to you: done`,
  },
} as const;

export function messageWords(locale: Locale = 'fr') {
  return catalog[locale];
}
