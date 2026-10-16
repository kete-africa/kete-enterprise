import type { Locale } from '../mail/index.js';

/** The words of the center's own policies, in French and English (doctrine D-013). */
const catalog = {
  fr: {
    baseCapabilities: 'Un outil donné à un agent peut servir',
    baseRequests: 'Une demande peut être ouverte',
    agentForNobody: 'Un agent qui ne travaille pour personne n’agit pas',
    circuit: (name: string) => `Le circuit « ${name} » décide`,
    approvalAsked: (sentence: string) => `Demande un accord : « ${sentence} »`,
  },
  en: {
    baseCapabilities: 'A tool given to an agent may be used',
    baseRequests: 'A request may be opened',
    agentForNobody: 'An agent working for nobody does not act',
    circuit: (name: string) => `The circuit “${name}” decides`,
    approvalAsked: (sentence: string) => `Asks for an approval: “${sentence}”`,
  },
} as const;

export function policyWords(locale: Locale = 'fr') {
  return catalog[locale];
}
