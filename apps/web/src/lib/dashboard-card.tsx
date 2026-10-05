import { Chart, axesOf } from '@/lib/chart';
import type { Card } from '@/lib/dashboards';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

/** One card: its figure, chart or table, or a word that its source is not hers to read. */
export function CardView({ card }: { card: Card }) {
  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
  if (!card.visible) return <p className="text-body-sm text-fg-muted">{m.dashboards_hidden()}</p>;
  if (card.rows.length === 0)
    return <p className="text-body-sm text-fg-muted">{m.dashboards_empty_card()}</p>;
  if (card.view === 'number') {
    const { value } = axesOf(card);
    const n = value ? card.rows[0]?.[value] : null;
    return (
      <p className="font-number text-display font-semibold">
        {typeof n === 'number' ? format.format(n) : '—'}
      </p>
    );
  }
  if (card.view === 'table') {
    const columns = Object.keys(card.rows[0] ?? {});
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-2 py-1 text-left font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {columns.map((c) => (
                  <td
                    key={c}
                    className={
                      typeof r[c] === 'number' ? 'px-2 py-1 text-right font-number' : 'px-2 py-1'
                    }
                  >
                    {typeof r[c] === 'number' ? format.format(r[c] as number) : (r[c] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <Chart card={card} />;
}
