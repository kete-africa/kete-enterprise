import type { Locale } from '../mail/index.js';

/** The Measure's words, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    corrective: (name: string, value: string, threshold: string, source: string) =>
      `Action corrective : « ${name} » à ${value}, au-delà du seuil ${threshold} (source : ${source}).`,
    correctiveMissing: (name: string, source: string) =>
      `Action corrective : « ${name} » sans donnée — sa source ne répond pas (${source}). Une donnée absente compte rouge.`,
    fromSource: (source: string, counted: number | null, at: string) =>
      `${source}${counted === null ? '' : ` · ${counted} lignes`} · lu le ${at}`,
  },
  en: {
    corrective: (name: string, value: string, threshold: string, source: string) =>
      `Corrective action: “${name}” at ${value}, past its threshold ${threshold} (source: ${source}).`,
    correctiveMissing: (name: string, source: string) =>
      `Corrective action: “${name}” has no data — its source does not answer (${source}). Missing data counts red.`,
    fromSource: (source: string, counted: number | null, at: string) =>
      `${source}${counted === null ? '' : ` · ${counted} rows`} · read on ${at}`,
  },
};

export function measureWords(locale: Locale = 'fr') {
  return catalog[locale];
}
