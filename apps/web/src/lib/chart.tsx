import { useEffect, useRef } from 'react';
import { getLocale } from '@/paraglide/runtime.js';
import type { DataCard } from '@/lib/dashboards';
import * as m from '@/paraglide/messages.js';

type Shown = Extract<DataCard, { visible: true }>;

/** The design's colors, read where the page is drawn: the charts follow the theme. */
function palette(): { series: string[]; text: string; line: string; muted: string } {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const series = [
    '--color-primary',
    '--color-accent',
    '--color-state-info',
    '--color-state-success',
    '--color-state-verify',
    '--color-state-error',
  ]
    .map(token)
    .filter(Boolean);
  return {
    series,
    text: token('--color-fg') || 'currentColor',
    line: token('--color-line') || '#ccc',
    muted: token('--color-fg-muted') || '#999',
  };
}

/** The first dimension and the first measure of a card's rows. */
export function axesOf(card: Shown): { label: string | null; value: string | null } {
  const columns = Object.keys(card.rows[0] ?? {});
  const value =
    columns.find((c) => typeof card.rows[0]?.[c] === 'number' || /\(|^count$/.test(c)) ?? null;
  const label = columns.find((c) => c !== value) ?? null;
  return { label, value };
}

/**
 * A card drawn by Apache ECharts (specs 033, 050): bars, a line or a pie over its rows, in the
 * design's colors; the period before, dashed, when she compares; a click on a bar or a slice
 * filters the board. ECharts is loaded in the browser only, when a chart is shown.
 */
export function Chart({
  card,
  selected,
  onSelect,
}: {
  card: Shown;
  selected?: string | null;
  onSelect?: (column: string, value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    let chart: { dispose(): void; resize(): void } | null = null;
    void import('echarts').then((echarts) => {
      if (disposed) return;
      const { series: colors, text, line, muted } = palette();
      const { label, value } = axesOf(card);
      const names = card.rows.map((r) => String((label ? r[label] : '') ?? '—'));
      const values = card.rows.map((r) => (value ? Number(r[value] ?? 0) : 0));
      const before = new Map(
        (card.previous ?? []).map((r) => [
          String((label ? r[label] : '') ?? '—'),
          value ? Number(r[value] ?? 0) : 0,
        ]),
      );
      const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
      const dim = (name: string) => (selected && selected !== name ? 0.35 : 1);
      const instance = echarts.init(element, null, { renderer: 'svg' });
      instance.setOption({
        color: colors,
        textStyle: { color: text },
        tooltip: {
          trigger: card.view === 'pie' ? 'item' : 'axis',
          valueFormatter: (v: unknown) => format.format(Number(v)),
        },
        ...(card.view === 'pie'
          ? {
              series: [
                {
                  type: 'pie',
                  radius: ['40%', '70%'],
                  data: names.map((name, i) => ({
                    name,
                    value: values[i],
                    itemStyle: { opacity: dim(name) },
                  })),
                  label: { color: text },
                },
              ],
            }
          : {
              grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
              xAxis: { type: 'category', data: names, axisLine: { lineStyle: { color: line } } },
              yAxis: { type: 'value', splitLine: { lineStyle: { color: line } } },
              series: [
                {
                  name: m.dashboards_now(),
                  type: card.view === 'line' ? 'line' : 'bar',
                  data: names.map((name, i) => ({
                    value: values[i],
                    itemStyle: { opacity: dim(name) },
                  })),
                  smooth: card.view === 'line',
                },
                ...(card.previous
                  ? [
                      {
                        name: m.dashboards_previous(),
                        type: 'line',
                        data: names.map((name) => before.get(name) ?? null),
                        lineStyle: { type: 'dashed', color: muted },
                        itemStyle: { color: muted },
                        symbol: 'none',
                      },
                    ]
                  : []),
              ],
            }),
      });
      if (label) {
        instance.on('click', (params: { name?: string }) => {
          if (params.name) select.current?.(label, params.name);
        });
      }
      chart = instance;
    });
    const resize = () => chart?.resize();
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      disposed = true;
      window.removeEventListener('resize', resize);
      observer.disconnect();
      chart?.dispose();
    };
  }, [card, selected]);
  return (
    <div
      ref={ref}
      className={`h-full min-h-40 w-full ${onSelect ? 'cursor-pointer' : ''}`}
      role="img"
      aria-label={card.title}
    />
  );
}
