import { useEffect, useRef } from 'react';
import { getLocale } from '@/paraglide/runtime.js';
import type { Card } from '@/lib/dashboards';

type Shown = Extract<Card, { visible: true }>;

/** The design's colors, read where the page is drawn: the charts follow the theme. */
function palette(): { series: string[]; text: string; line: string } {
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
 * A card drawn by Apache ECharts (spec 033): bars, a line or a pie over its rows, in the design's
 * colors. ECharts is loaded in the browser only, when a chart is shown.
 */
export function Chart({ card }: { card: Shown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    let chart: { dispose(): void; resize(): void } | null = null;
    void import('echarts').then((echarts) => {
      if (disposed) return;
      const { series: colors, text, line } = palette();
      const { label, value } = axesOf(card);
      const names = card.rows.map((r) => String((label ? r[label] : '') ?? '—'));
      const values = card.rows.map((r) => (value ? Number(r[value] ?? 0) : 0));
      const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
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
                  data: names.map((name, i) => ({ name, value: values[i] })),
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
                  type: card.view === 'line' ? 'line' : 'bar',
                  data: values,
                  smooth: card.view === 'line',
                },
              ],
            }),
      });
      chart = instance;
    });
    const resize = () => chart?.resize();
    window.addEventListener('resize', resize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', resize);
      chart?.dispose();
    };
  }, [card]);
  return <div ref={ref} className="h-64 w-full" role="img" aria-label={card.title} />;
}
