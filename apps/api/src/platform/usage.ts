import { modelPricesFromEnv, postgresBudgetStore } from '@kete/ai';
import { getPool } from './db.js';

// Every model call is journaled here (spec 037): its tokens and, with `KETE_AI_PRICES`, its cost,
// read back by the administrators' usage report.

let store: ReturnType<typeof postgresBudgetStore> | undefined;

/** The instance's usage journal and budgets, prices included when configured. */
export function usageStore(): ReturnType<typeof postgresBudgetStore> {
  store ??= postgresBudgetStore(getPool(), { prices: modelPricesFromEnv() });
  return store;
}
