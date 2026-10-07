import { applyTheme, Icon, PageSection, PageTitle, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { kindIcon, why } from '@/lib/day';
import { Dictation } from '@/lib/dictation';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchToday, keyOf, type DayItem } from '@/lib/today';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/terrain')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchToday(),
  component: FieldPage,
});

const big =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control px-5 text-[18px] font-semibold';

/** « dans 40 min », « il y a 2 h »: how far a moment is, in the reader's language. */
function distance(at: string, now: number): string {
  const minutes = Math.round((new Date(at).getTime() - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  if (Math.abs(minutes) < 90) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 36
    ? format.format(hours, 'hour')
    : format.format(Math.round(hours / 24), 'day');
}

const hour = (at: string) =>
  new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
const day = (at: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(at),
  );

/**
 * « Terrain » (spec 059): the day read on a phone, outdoors, one hand free — the next dated
 * subject in large type, the gesture that opens it, a report dictated and read back, what comes
 * after. « Plein soleil » turns the light theme on, which reads better in bright light.
 */
function FieldPage() {
  const { me } = Route.useRouteContext();
  const today = Route.useLoaderData();
  // The time is the reader's: known once the page runs in her browser.
  const [now, setNow] = useState<number | null>(null);
  const [sun, setSun] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    setSun(document.documentElement.getAttribute('data-theme') === 'light');
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const dated = today.day
    .filter((item): item is DayItem & { dueAt: string } => item.dueAt !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  // The next one to come; when everything is past, the latest one that still waits.
  const next = dated.find((item) => !item.overdue) ?? dated.at(-1) ?? null;
  const then = dated.filter((item) => item !== next).slice(0, 5);
  const others = today.day.length - dated.length;

  return (
    <AppShell me={me} current="field">
      <div className="mx-auto grid w-full max-w-xl gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold text-fg-muted first-letter:uppercase">
            {day(new Date().toISOString())}
          </p>
          <button
            type="button"
            aria-pressed={sun}
            className="inline-flex min-h-14 items-center gap-2 rounded-control border border-line-control px-4 font-semibold text-fg hover:bg-surface-hover"
            onClick={() => {
              applyTheme(sun ? 'dark' : 'light');
              setSun(!sun);
            }}
          >
            {m.terrain_sun()}
          </button>
        </div>
        <PageTitle>{m.terrain_title()}</PageTitle>

        {next ? (
          <section
            aria-label={m.terrain_next()}
            className="grid gap-4 rounded-box border border-line bg-surface p-5"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-display font-semibold tabular-nums">{hour(next.dueAt)}</span>
              {now !== null && (
                <span
                  className={`text-[18px] font-semibold ${next.overdue ? 'text-state-error-fg' : 'text-fg-muted'}`}
                >
                  {distance(next.dueAt, now)}
                </span>
              )}
            </div>
            <div className="grid gap-1">
              <p className="text-fg-muted first-letter:uppercase">{day(next.dueAt)}</p>
              <h2 className="text-title font-semibold">{next.title}</h2>
              <p className="flex flex-wrap items-center gap-2 text-fg-muted">
                <Icon name={kindIcon[next.kind]} size={18} />
                {why(next)}
              </p>
              {next.overdue && (
                <div>
                  <Tag tone="error">{m.today_overdue()}</Tag>
                </div>
              )}
            </div>
            <a
              className={`${big} bg-action text-on-action hover:bg-action-strong`}
              href={next.href}
            >
              {m.today_open()}
            </a>
          </section>
        ) : (
          <p className="text-[18px] text-fg-muted">{m.terrain_nothing()}</p>
        )}

        {!me.viewedBy && (
          <PageSection title={m.terrain_report()}>
            <Dictation about={next ? { key: keyOf(next), title: next.title } : null} />
          </PageSection>
        )}

        {then.length > 0 && (
          <PageSection title={m.terrain_then()}>
            <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
              {then.map((item) => (
                <li key={keyOf(item)}>
                  <a
                    href={item.href}
                    className="flex min-h-16 items-center gap-4 px-4 py-3 text-fg hover:bg-surface-hover"
                  >
                    <span className="w-16 shrink-0 text-[18px] font-semibold tabular-nums">
                      {hour(item.dueAt)}
                    </span>
                    <span className="grid min-w-0">
                      <span className="font-semibold">{item.title}</span>
                      <span className="text-body-sm text-fg-muted first-letter:uppercase">
                        {day(item.dueAt)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </PageSection>
        )}

        {others > 0 && (
          <p className="mt-4">
            <a
              className={`${big} border border-line-control text-fg hover:bg-surface-hover`}
              href="/a-faire"
            >
              {m.terrain_others({ count: String(others) })}
            </a>
          </p>
        )}
      </div>
    </AppShell>
  );
}
