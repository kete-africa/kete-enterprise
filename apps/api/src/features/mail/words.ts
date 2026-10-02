/**
 * The words of the e-mails' frame, in French and English (doctrine D-013). Each feature keeps the
 * words of its own e-mails beside it, in the same shape.
 */
export type Locale = 'fr' | 'en';

const catalog = {
  fr: {
    copyLink: 'Si le bouton ne s’ouvre pas, copiez ce lien dans votre navigateur :',
    personal: 'Ce lien vous est personnel : ne le transférez pas.',
  },
  en: {
    copyLink: 'If the button does not open, copy this link into your browser:',
    personal: 'This link is yours alone: do not forward it.',
  },
} as const;

export function words(locale: Locale) {
  return catalog[locale];
}
