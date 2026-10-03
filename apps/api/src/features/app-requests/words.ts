// The words the API writes for people about their app requests (spec 021): the tasks it puts in
// their To do. The screens have their own catalogs; these are the API's.

const fr = {
  ready: (name: string) => `Votre app « ${name} » est prête : essayez-la`,
  review: (name: string) => `Relire la première version de « ${name} »`,
  failed: (name: string) => `La création de « ${name} » a échoué : voir la demande`,
};

const en: typeof fr = {
  ready: (name) => `Your app « ${name} » is ready: try it`,
  review: (name) => `Review the first version of « ${name} »`,
  failed: (name) => `Creating « ${name} » failed: see the request`,
};

export function appRequestWords(locale: 'fr' | 'en') {
  return locale === 'en' ? en : fr;
}
