import { Chart, axesOf } from '@/lib/chart';
import type { Card } from '@/lib/dashboards';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

/** A figure, its rise or fall against the period before, its goal and its threshold (spec 050). */
function Figure({ card }: { card: Extract<Card, { kind: 'data'; visible: true }> }) {
  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
  const { value } = axesOf(card);
  const n = value ? card.rows[0]?.[value] : null;
  const before = value ? card.previous?.[0]?.[value] : null;
  const change =
    typeof n === 'number' && typeof before === 'number' && before !== 0
      ? (n - before) / Math.abs(before)
      : null;
  // Rising is good unless its goal says lower is better; without a goal, neither colour.
  const better = card.goal?.better ?? null;
  const tone =
    change === null || Math.abs(change) < 0.005 || better === null
      ? 'text-fg-muted'
      : (better === 'up') === change > 0
        ? 'text-state-success-fg'
        : 'text-state-error-fg';
  const share =
    change === null
      ? null
      : new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(
          Math.abs(change),
        );
  const percent =
    change === null || share === null
      ? null
      : change > 0
        ? m.dashboards_rise({ percent: share })
        : change < 0
          ? m.dashboards_fall({ percent: share })
          : share;
  const met =
    typeof n === 'number' && card.goal
      ? card.goal.better === 'up'
        ? n >= card.goal.value
        : n <= card.goal.value
      : null;
  const over = typeof n === 'number' && card.threshold !== null && n > card.threshold;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-number text-display font-semibold">
          {typeof n === 'number' ? format.format(n) : '—'}
        </span>
        {percent && (
          <span
            className={`text-body-sm font-semibold ${tone}`}
            aria-label={m.dashboards_change({ change: percent })}
          >
            {percent}
          </span>
        )}
      </div>
      {over && card.threshold !== null && (
        <p className="text-body-sm font-semibold text-state-verify-fg">
          {m.dashboards_over_threshold({ value: format.format(card.threshold) })}
        </p>
      )}
      {card.goal && (
        <p className="text-body-sm text-fg-muted">
          {(card.goal.better === 'up' ? m.dashboards_goal_up : m.dashboards_goal_down)({
            value: format.format(card.goal.value),
          })}{' '}
          · {met ? m.dashboards_goal_met() : m.dashboards_goal_not_met()}
        </p>
      )}
    </div>
  );
}

/** One card: a note, a figure, a chart or a table — or a word that its source is not hers. */
export function CardView({
  card,
  selected,
  onSelect,
}: {
  card: Card;
  selected?: string | null;
  onSelect?: (column: string, value: string) => void;
}) {
  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
  if (card.kind === 'note') {
    return <p className="whitespace-pre-wrap text-body">{card.text}</p>;
  }
  if (!card.visible) return <p className="text-body-sm text-fg-muted">{m.dashboards_hidden()}</p>;
  const notFiltered =
    card.filtered === false ? (
      <p className="text-body-sm text-fg-muted">{m.dashboards_not_filtered()}</p>
    ) : null;
  if (card.rows.length === 0)
    return (
      <>
        <p className="text-body-sm text-fg-muted">{m.dashboards_empty_card()}</p>
        {notFiltered}
      </>
    );
  if (card.view === 'number') {
    return (
      <>
        <Figure card={card} />
        {notFiltered}
      </>
    );
  }
  if (card.view === 'table') {
    const columns = Object.keys(card.rows[0] ?? {});
    return (
      <div className="overflow-auto">
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
        {notFiltered}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-0 flex-1">
        <Chart
          card={card}
          {...(selected !== undefined ? { selected } : {})}
          {...(onSelect ? { onSelect } : {})}
        />
      </div>
      {notFiltered}
    </div>
  );
}
