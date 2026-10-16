import type { Locale } from '../mail/index.js';

/** The words of threads and channels in the center, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    keteThread: 'Kete',
    received: 'Message reçu, merci. Nous revenons vers vous.',
    noted: 'C’est noté dans votre fil Kete.',
  },
  en: {
    keteThread: 'Kete',
    received: 'Message received, thank you. We will come back to you.',
    noted: 'Noted in your Kete thread.',
  },
} as const;

export function messageWords(locale: Locale = 'fr') {
  return catalog[locale];
}
