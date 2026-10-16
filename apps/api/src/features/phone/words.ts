import type { Locale } from '../mail/index.js';

/** What the center says on a phone, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    waiting: (title: string) => `Votre décision est attendue : ${title}`,
    approve: 'Approuver',
    refuse: 'Refuser',
    approved: (title: string) => `Approuvé : ${title}. C’est noté dans Kete Enterprise.`,
    refused: (title: string) => `Refusé : ${title}. C’est noté dans Kete Enterprise.`,
    notYours:
      'Cette décision n’est plus la vôtre : elle a été prise, ou elle attend quelqu’un d’autre.',
    linked:
      'Votre téléphone est relié à Kete Enterprise : ce qui attend votre décision arrivera ici.',
  },
  en: {
    waiting: (title: string) => `Your decision is awaited: ${title}`,
    approve: 'Approve',
    refuse: 'Refuse',
    approved: (title: string) => `Approved: ${title}. Recorded in Kete Enterprise.`,
    refused: (title: string) => `Refused: ${title}. Recorded in Kete Enterprise.`,
    notYours: 'This decision is no longer yours: it was taken, or it waits for someone else.',
    linked: 'Your phone is tied to Kete Enterprise: what waits for your decision will arrive here.',
  },
};

export function phoneWords(locale: Locale = 'fr') {
  return catalog[locale] ?? catalog.fr;
}
