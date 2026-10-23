import { EmptyState, PageHeader, Tag } from '@kete/design';
import type { View } from '@kete/sdk';
import {
  Bullet,
  EChart,
  isEchart,
  Provenance,
  StateOf,
  TileMap,
  type FigureState,
} from '@kete/views/react';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type CSSProperties } from 'react';
import { fetchObjects } from '@/lib/objects';
import { fetchView, readViewData, restoreMyView, type ViewData } from '@/lib/views';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';

const PLACE = 'board:steering';
type Period = 'quarter' | '30d' | 'year';
type Search = { periode?: Period; unite?: string };

/** The days a board's period covers, ending today. */
function rangeOf(period: Period, today = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from =
    period === 'year'
      ? new Date(today.getFullYear(), 0, 1)
      : period === '30d'
        ? new Date(today.getTime() - 29 * 86_400_000)
        : new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  return { from: iso(from), to: iso(today) };
}

export const Route = createFileRoute('/pilotage')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(search['periode'] === '30d' || search['periode'] === 'year'
      ? { periode: search['periode'] }
      : {}),
    ...(typeof search['unite'] === 'string' ? { unite: search['unite'].slice(0, 80) } : {}),
  }),
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const placed = await fetchView({ data: { place: PLACE } });
    const units = (await fetchObjects({ data: { kind: 'unit' } })).objects;
    if (!placed || placed.view.kind !== 'board') return { placed, units, cards: [] };
    const range = rangeOf(deps.periode ?? 'quarter');
    const filter = deps.unite ? { unit_id: deps.unite } : {};
    // Each card read with her rights, the board's filters and its period, all at once.
    const cards = await Promise.all(
      (placed.view.board?.cards ?? []).map(async (card) => ({
        card,
        data: await readViewData({
          data: {
            view: card.view as View,
            filter: card.view.context?.includes('unit') ? filter : {},
            ...(card.view.context?.includes('period') ? range : {}),
          },
        }),
      })),
    );
    return { placed, units, cards };
  },
  component: SteeringPage,
});

const words = () => ({
  now: m.views_now(),
  before: m.views_before(),
  cumulative: m.views_cumulative(),
  trajectory: m.views_trajectory(),
  share: m.views_share(),
});
const states = (): Record<FigureState, string> => ({
  loading: m.views_loading(),
  empty: m.views_empty(),
  missing: m.views_missing(),
  denied: m.views_denied(),
  stale: m.views_stale(),
});
const format = (value: number | null, unit?: string | null) =>
  value === null
    ? '—'
    : `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value)}${
        unit === 'percent' ? ' %' : ''
      }`;
const colourWords: Record<string, () => string> = {
  green: m.measure_colour_green,
  orange: m.measure_colour_orange,
  red: m.measure_colour_red,
};
const tone = (colour: string | null) =>
  colour === 'green'
    ? 'validated'
    : colour === 'orange'
      ? 'verify'
      : colour === 'red'
        ? 'error'
        : 'neutral';

/** One card's figure, by its chart; every state said, never a zero for what is not known. */
function Figure({
  view,
  data,
  onSelect,
}: {
  view: View;
  data: ViewData;
  onSelect?: (part: string) => void;
}) {
  const title = getLocale() === 'en' ? view.title.en : view.title.fr;
  const chart = view.figure?.chart ?? 'number';
  if (data.state !== 'done' && data.readings.length === 0) {
    return <StateOf state={data.state} words={states()} />;
  }
  if (chart === 'scorecard') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="px-1.5 py-1">{m.measure_indicator()}</th>
              <th className="px-1.5 py-1">{m.measure_target()}</th>
              <th className="px-1.5 py-1 text-right">{m.measure_realised()}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.readings.map((r) => (
              <tr key={r.indicatorId}>
                <td className="px-1.5 py-1.5">{r.name}</td>
                <td className="px-1.5 py-1.5 tabular-nums">
                  {r.target === null ? '—' : format(r.target, r.unit)}
                </td>
                <td className="px-1.5 py-1.5 text-right">
                  {r.status === 'missing' ? (
                    <Tag tone="error">{m.measure_missing()}</Tag>
                  ) : r.status === 'typed' ? (
                    <span className="text-fg-muted">{m.measure_typed()}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2 font-semibold tabular-nums">
                      {format(r.value, r.unit)}
                      {r.colour && <Tag tone={tone(r.colour)}>{colourWords[r.colour]?.()}</Tag>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (chart === 'bullet' || (chart === 'number' && data.readings.length > 0)) {
    const r = data.readings[0];
    if (!r) return <StateOf state="empty" words={states()} />;
    if (r.status === 'missing') return <StateOf state="missing" words={states()} />;
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[1.6rem] font-semibold tabular-nums">{format(r.value, r.unit)}</span>
        {chart === 'bullet' && (
          <Bullet
            value={r.value}
            target={r.target}
            threshold={r.threshold}
            better={
              r.threshold !== null && r.target !== null && r.threshold > r.target ? 'down' : 'up'
            }
            label={`${title} : ${format(r.value, r.unit)}`}
          />
        )}
        {r.colour && <Tag tone={tone(r.colour)}>{colourWords[r.colour]?.()}</Tag>}
      </div>
    );
  }
  const first = data.rows[0] ?? {};
  const label = Object.keys(first).find((k) => typeof first[k] !== 'number') ?? '';
  const value = Object.keys(first).find((k) => typeof first[k] === 'number') ?? '';
  if (chart === 'tilemap') {
    return (
      <TileMap
        rows={data.rows}
        label={label}
        value={value}
        name={title}
        {...(onSelect ? { onSelect } : {})}
      />
    );
  }
  if (chart === 'number') {
    return (
      <span className="text-[1.6rem] font-semibold tabular-nums">
        {format(
          typeof first[value] === 'number' ? (first[value] as number) : null,
          view.figure?.unit,
        )}
      </span>
    );
  }
  if (isEchart(chart)) {
    return (
      <div className="h-56">
        <EChart
          chart={chart}
          label={title}
          input={{
            rows: data.rows,
            words: words(),
            target: view.figure?.target ?? null,
            threshold: view.figure?.threshold ?? null,
          }}
          {...(onSelect ? { onSelect } : {})}
        />
      </div>
    );
  }
  return <StateOf state="empty" words={states()} />;
}

/**
 * The steering board (spec 103; canvas v7, « Le tableau de bord »): a view.v1 board — Kete's
 * default built from the organization's indicators and the center's sources, or the version her
 * organization, her position or she made. Each card read with her rights, the board's period and
 * unit; « D'où vient ce chiffre ? » on every card; one card per screen on a phone.
 */
function SteeringPage() {
  const { me } = Route.useRouteContext();
  const { placed, units, cards } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/pilotage' });
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!placed) {
    return (
      <AppShell me={me} current="steering">
        <EmptyState title={m.views_none()} />
      </AppShell>
    );
  }
  const title = getLocale() === 'en' ? placed.view.title.en : placed.view.title.fr;
  const levelWords: Record<string, () => string> = {
    app: m.views_level_app,
    organization: m.views_level_organization,
    position: m.views_level_position,
    person: m.views_level_person,
  };
  const ordered = [...cards].sort(
    (a, b) => a.card.place.y - b.card.place.y || a.card.place.x - b.card.place.x,
  );
  const select =
    'h-(--control-height) rounded-control border border-line-control bg-surface px-2 text-body-sm';
  return (
    <AppShell me={me} current="steering">
      <PageHeader
        title={title}
        description={m.views_explain({ level: levelWords[placed.level]?.() ?? '' })}
      />
      <div
        role="group"
        aria-label={m.views_filters()}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <label className="flex items-center gap-1.5 text-body-sm">
          {m.views_period()}
          <select
            className={select}
            value={search.periode ?? 'quarter'}
            onChange={(e) =>
              void navigate({
                search: (s): Search => ({
                  ...(s.unite ? { unite: s.unite } : {}),
                  ...(e.target.value === 'quarter' ? {} : { periode: e.target.value as Period }),
                }),
              })
            }
          >
            <option value="quarter">{m.views_period_quarter()}</option>
            <option value="30d">{m.views_period_30d()}</option>
            <option value="year">{m.views_period_year()}</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-body-sm">
          {m.views_unit()}
          <select
            className={select}
            value={search.unite ?? ''}
            onChange={(e) =>
              void navigate({
                search: (s): Search => ({
                  ...(s.periode ? { periode: s.periode } : {}),
                  ...(e.target.value ? { unite: e.target.value } : {}),
                }),
              })
            }
          >
            <option value="">{m.views_unit_all()}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.title}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        {placed.level === 'person' && (
          <button
            type="button"
            className="h-(--control-height) rounded-control border border-line-control px-2.5 text-body-sm font-semibold"
            onClick={async () => {
              setError(null);
              const answer = await restoreMyView({ data: { place: PLACE } });
              if (!answer.ok) return setError(m.views_restore_failed());
              await router.invalidate();
            }}
          >
            {m.views_restore()}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-3 text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        {ordered.map(({ card, data }, i) => (
          <section
            key={`${card.view.id ?? i}`}
            aria-label={getLocale() === 'en' ? card.view.title.en : card.view.title.fr}
            className="order-(--phone) flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-3 md:order-none md:col-span-(--width)"
            style={{ '--width': card.place.w, '--phone': card.phone ?? i } as CSSProperties}
          >
            <h2 className="flex items-center gap-2 text-body font-semibold">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {getLocale() === 'en' ? card.view.title.en : card.view.title.fr}
              </span>
            </h2>
            <div className="min-h-0 flex-1">
              <Figure view={card.view as View} data={data} />
            </div>
            {data.provenance && (
              <Provenance summary={m.measure_whence()}>
                {m.measure_provenance({
                  source: data.provenance.source,
                  rows:
                    data.provenance.counted === null
                      ? ''
                      : m.measure_rows({ count: data.provenance.counted }),
                  at: new Intl.DateTimeFormat(getLocale(), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(data.provenance.at)),
                })}
              </Provenance>
            )}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
