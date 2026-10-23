import { EmptyState, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchIndicators, type Indicator, type Reading } from '@/lib/measure';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';

type Search = { indicateur?: string };

/** The quarter so far: what the scorecard reads by default. */
function quarterSoFar(today = new Date()) {
  const month = Math.floor(today.getMonth() / 3) * 3;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${today.getFullYear()}-${pad(month + 1)}-01`,
    to: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
  };
}

export const Route = createFileRoute('/indicateurs')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search['indicateur'] === 'string'
      ? { indicateur: search['indicateur'].slice(0, 100) }
      : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const period = quarterSoFar();
    return { period, ...(await fetchIndicators({ data: period })) };
  },
  component: IndicatorsPage,
});

const number = (value: number, unit: string | null) =>
  `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value)}${
    unit === 'percent' ? ' %' : ''
  }`;

const toneOf = (colour: Reading['colour']) =>
  colour === 'green'
    ? 'validated'
    : colour === 'orange'
      ? 'verify'
      : colour === 'red'
        ? 'error'
        : 'neutral';

const colourWords = {
  green: m.measure_colour_green,
  orange: m.measure_colour_orange,
  red: m.measure_colour_red,
};

function target(indicator: Indicator) {
  if (indicator.target === null || indicator.direction === null) return '—';
  return `${indicator.direction === 'higher' ? '≥' : '≤'} ${number(indicator.target, indicator.unit)}`;
}

function Realised({ reading, indicator }: { reading: Reading | undefined; indicator: Indicator }) {
  if (!reading || reading.status === 'typed') {
    return <span className="text-fg-muted">{m.measure_typed()}</span>;
  }
  if (reading.status === 'missing') return <Tag tone="error">{m.measure_missing()}</Tag>;
  if (reading.status === 'denied' || reading.status === 'refused') {
    return <span className="text-fg-muted">{m.measure_denied()}</span>;
  }
  if (reading.value === null) return <span className="text-fg-muted">{m.measure_nothing()}</span>;
  return (
    <span className="font-semibold tabular-nums">{number(reading.value, indicator.unit)}</span>
  );
}

/** « D'où vient ce chiffre ? »: its source, the filters it applied, the rows counted, the moment. */
function Provenance({ reading }: { reading: Reading }) {
  const at = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(reading.provenance.at));
  const filters = Object.keys(reading.provenance.filter).length;
  return (
    <details className="text-caption text-fg-muted">
      <summary className="cursor-pointer select-none">{m.measure_whence()}</summary>
      <p className="mt-1 [overflow-wrap:anywhere]">
        {m.measure_provenance({
          source: reading.provenance.source,
          rows:
            reading.provenance.counted === null
              ? ''
              : m.measure_rows({ count: reading.provenance.counted }),
          at,
        })}
        {filters > 0 ? ` ${m.measure_filtered({ count: filters })}` : ''}
      </p>
    </details>
  );
}

/**
 * The indicators (spec 102; canvas v7, « Le tableau de bord », « Le trimestre en un coup d'œil »):
 * each read live with her rights over the quarter so far — its target, what is realised, its colour,
 * leading or lagging, and where the figure comes from. A source that does not answer says so, red.
 */
function IndicatorsPage() {
  const { me } = Route.useRouteContext();
  const { indicators, readings, period } = Route.useLoaderData();
  const search = Route.useSearch();
  const byId = new Map(readings.map((r) => [r.indicatorId, r]));
  const cell = 'px-2 py-2 align-top';
  // Read live first; those typed with their proof are named below, folded.
  const live = indicators.filter((i) => i.source && i.source.kind !== 'typed');
  const typed = indicators.filter((i) => !i.source || i.source.kind === 'typed');
  const day = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long' }).format(
      new Date(`${value}T12:00:00`),
    );
  return (
    <AppShell me={me} current="indicators">
      <PageHeader
        title={m.nav_indicators()}
        description={m.measure_explain({ from: day(period.from), to: day(period.to) })}
      />
      <PageSection title={m.measure_scorecard()}>
        {live.length === 0 ? (
          <EmptyState title={indicators.length === 0 ? m.measure_none() : m.measure_none_live()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-body-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className={cell}>{m.measure_indicator()}</th>
                  <th className={cell}>{m.measure_target()}</th>
                  <th className={`${cell} text-right`}>{m.measure_realised()}</th>
                  <th className={cell}>
                    <span className="sr-only">{m.measure_colour()}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {live.map((indicator) => {
                  const reading = byId.get(indicator.indicatorId);
                  const focused = search.indicateur === indicator.indicatorId;
                  return (
                    <tr
                      key={indicator.indicatorId}
                      id={indicator.indicatorId}
                      aria-current={focused ? 'true' : undefined}
                      className="aria-[current=true]:bg-selected"
                    >
                      <td className={cell}>
                        <div className="font-semibold">{indicator.name}</div>
                        <div className="text-caption text-fg-muted">
                          {indicator.leading ? m.measure_leading() : m.measure_lagging()}
                          {indicator.frequency ? ` · ${indicator.frequency}` : ''}
                        </div>
                        {reading && reading.status !== 'typed' && <Provenance reading={reading} />}
                      </td>
                      <td className={`${cell} tabular-nums`}>{target(indicator)}</td>
                      <td className={`${cell} text-right`}>
                        <Realised reading={reading} indicator={indicator} />
                      </td>
                      <td className={cell}>
                        {reading?.colour && (
                          <Tag tone={toneOf(reading.colour)}>{colourWords[reading.colour]()}</Tag>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
      {typed.length > 0 && (
        <PageSection title={m.measure_typed_title()}>
          <details className="text-body-sm">
            <summary className="cursor-pointer select-none text-fg-muted">
              {m.measure_typed_count({ count: typed.length })}
            </summary>
            <ul className="mt-2 columns-1 gap-6 sm:columns-2">
              {typed.map((indicator) => (
                <li key={indicator.indicatorId} className="break-inside-avoid py-0.5">
                  {indicator.name}
                </li>
              ))}
            </ul>
          </details>
        </PageSection>
      )}
    </AppShell>
  );
}
