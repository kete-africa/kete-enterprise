import { getLocale } from '@/paraglide/runtime.js';

// Amounts as the screens show them. An amount travels as an integer of its currency's smallest
// unit (`@kete/money`, kete-core spec 094): the screens only format it.

/** « 2 480 000 F CFA », « 12,50 € »: in her language, with the currency's own decimals. */
export function shownMoney(amount: number, currency: string): string {
  const format = new Intl.NumberFormat(getLocale(), { style: 'currency', currency });
  const decimals = format.resolvedOptions().maximumFractionDigits ?? 0;
  return format.format(amount / 10 ** decimals);
}
