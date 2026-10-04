import type { Payer } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';

const payerName: Record<Payer, () => string> = {
  organization: m.payer_organization,
  key: m.payer_key,
  subscription: m.payer_subscription,
};

const REMEMBERED = 'kete.chat.payer';

/** The payer she chose last on this device, if it is still allowed; the first allowed otherwise. */
export function rememberedPayer(allowed: Payer[]): Payer | null {
  try {
    const kept = window.localStorage.getItem(REMEMBERED) as Payer | null;
    if (kept && allowed.includes(kept)) return kept;
  } catch {
    // No storage here: the first allowed.
  }
  return allowed[0] ?? null;
}

/**
 * « Pay with » (spec 026b), under the composer: the organization, her key or her subscription —
 * only those the organization's policy allows, shown when there is a choice.
 */
export function PayWith({
  payers,
  value,
  onChange,
}: {
  payers: Payer[];
  value: Payer | null;
  onChange: (payer: Payer) => void;
}) {
  if (payers.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 text-body-sm text-fg-muted">
      {m.pay_with()}
      <select
        value={value ?? payers[0]}
        onChange={(event) => {
          const payer = event.target.value as Payer;
          try {
            window.localStorage.setItem(REMEMBERED, payer);
          } catch {
            // Remembered for this page only.
          }
          onChange(payer);
        }}
        className="h-8 rounded-control border border-line-control bg-surface-control px-2 font-semibold text-fg"
      >
        {payers.map((p) => (
          <option key={p} value={p}>
            {payerName[p]()}
          </option>
        ))}
      </select>
    </label>
  );
}
