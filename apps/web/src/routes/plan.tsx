import {
  PageHeader,
  TeamLanes,
  WeekCalendar,
  type CalendarDay,
  type CalendarDayItem,
  type CalendarItem,
  type CalendarTone,
  type CalendarWords,
  type LaneCell,
  type LaneRow,
} from '@kete/design';
import type { DatedFact } from '@kete/sdk';
import { occurrences, placeInDays, type Occurrence } from '@kete/time';
import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { addDays, fetchDays, type Clash, type Scope, type SeenFact } from '@/lib/time';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

type Search = { vue?: 'equipe' | 'organisation'; du?: string };
const scopeOf = (vue: Search['vue']): Scope =>
  vue === 'equipe' ? 'team' : vue === 'organisation' ? 'organization' : 'me';

export const Route = createFileRoute('/planifier')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(search['vue'] === 'equipe' || search['vue'] === 'organisation'
      ? { vue: search['vue'] }
      : {}),
    ...(typeof search['du'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search['du'])
      ? { du: search['du'] }
      : {}),
  }),
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ vue: search.vue, du: search.du }),
  loader: ({ deps }) =>
    fetchDays({ data: { scope: scopeOf(deps.vue), ...(deps.du ? { from: deps.du } : {}) } }),
  component: PlanPage,
});

const time = (minutes: number) =>
  new Intl.DateTimeFormat(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2026, 0, 1, 0, minutes));

/** The words of a fact she may not read: who is busy, who is away — never why. */
function labelOf(fact: SeenFact): string {
  if (!fact.masked) return fact.label;
  return fact.kind === 'absence' ? m.plan_away() : m.plan_busy();
}

const toneOf = (o: Occurrence): CalendarTone =>
  o.kind === 'meeting' ? 'meeting' : o.kind === 'agent_run' ? 'agent' : 'task';

/**
 * Planifier (spec 079, doctrine D-050): the time of the whole organization, as the apps say it —
 * her week, her team's lanes, or the organization's by her rights — and what clashes, said first.
 */
function PlanPage() {
  const { me } = Route.useRouteContext();
  const days = Route.useLoaderData();
  const search = Route.useSearch();
  const today = new Date().toISOString().slice(0, 10);
  const nameOf = (userId: string) =>
    days.people.find((p) => p.userId === userId)?.name ?? m.plan_someone();
  const facts = days.facts.map((fact) => ({ ...fact, label: labelOf(fact) }));
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  // The same shape as the contract: what @kete/time places on the days.
  const shown = occurrences(facts as unknown as DatedFact[]);
  const hrefOf = (key: string) => {
    const href = byKey.get(key)?.href;
    return href ? { href } : {};
  };
  const placed = placeInDays(shown, { from: days.from, days: 7 });
  const dayWords = new Intl.DateTimeFormat(getLocale(), { weekday: 'short', timeZone: 'UTC' });
  const calendarDays: CalendarDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(days.from, index);
    return {
      key: day,
      label: dayWords.format(Date.parse(`${day}T00:00:00Z`)),
      number: Number(day.slice(8)),
      today: day === today,
      rest: index > 4,
    };
  });
  const words: CalendarWords = {
    label: m.plan_week({ from: days.from }),
    allDay: m.plan_all_day(),
    time,
    now: m.plan_now(),
    proposed: m.plan_proposed(),
  };
  const clashed = new Set(days.conflicts.flatMap((c) => (c.fact ? [c.fact] : (c.facts ?? []))));
  const allDay: CalendarDayItem[] = placed.allDay.map((p) => ({
    key: `${p.occurrence.key}-${p.day}`,
    day: p.day,
    label:
      p.occurrence.kind === 'absence' && !p.occurrence.people.includes(me.userId)
        ? m.plan_person_away({ name: nameOf(p.occurrence.people[0] ?? '') })
        : p.occurrence.label,
    tone: p.occurrence.kind === 'absence' ? 'absence' : 'deadline',
    ...hrefOf(p.occurrence.key),
  }));
  const items: CalendarItem[] = placed.timed.map((p) => ({
    key: `${p.occurrence.key}-${p.day}`,
    day: p.day,
    from: p.from,
    to: p.to,
    title: p.occurrence.label,
    tone: clashed.has(p.occurrence.key) ? 'conflict' : toneOf(p.occurrence),
    ...hrefOf(p.occurrence.key),
  }));
  const lanePeople = days.people.length ? days.people : [{ userId: me.userId, name: me.name }];
  const rows: LaneRow[] = lanePeople.map((person) => {
    const hers = placeInDays(
      shown.filter((o) => o.people.includes(person.userId)),
      { from: days.from, days: 5 },
    );
    return {
      kind: 'person',
      key: person.userId,
      who: person.name,
      days: [0, 1, 2, 3, 4].map((day): LaneCell[] => [
        ...hers.allDay
          .filter((p) => p.day === day)
          .map((p) => ({
            key: p.occurrence.key,
            label: p.occurrence.kind === 'absence' ? m.plan_away() : p.occurrence.label,
            tone: p.occurrence.kind === 'absence' ? ('absence' as const) : ('busy' as const),
          })),
        ...hers.timed
          .filter((p) => p.day === day)
          .map((p) => ({
            key: p.occurrence.key,
            label: `${p.occurrence.label} · ${time(p.from)}`,
            tone: clashed.has(p.occurrence.key) ? ('conflict' as const) : ('busy' as const),
          })),
      ]),
    };
  });
  const said = (clash: Clash) => {
    const at = new Intl.DateTimeFormat(getLocale(), {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(clash.start);
    return clash.kind === 'absent'
      ? m.plan_clash_absent({
          name: nameOf(clash.person),
          what: byKey.get(clash.fact ?? '')?.label ?? '',
          at,
        })
      : m.plan_clash_overlap({
          name: nameOf(clash.person),
          first: byKey.get(clash.facts?.[0] ?? '')?.label ?? '',
          second: byKey.get(clash.facts?.[1] ?? '')?.label ?? '',
          at,
        });
  };
  const link = (vue: Search['vue'], du = search.du) =>
    `/planifier?${new URLSearchParams({ ...(vue ? { vue } : {}), ...(du ? { du } : {}) })}`;
  const scopes: [Search['vue'], string, boolean][] = [
    [undefined, m.plan_scope_me(), true],
    ['equipe', m.plan_scope_team(), true],
    ['organisation', m.plan_scope_organization(), days.canSeeOrganization],
  ];

  return (
    <AppShell me={me} current="plan">
      <PageHeader
        title={m.nav_plan()}
        description={m.plan_explain()}
        actions={
          <nav aria-label={m.plan_weeks()} className="flex flex-wrap gap-2">
            <a
              className="rounded-control px-3 py-2 text-body-sm hover:bg-surface-hover"
              href={link(search.vue, addDays(days.from, -7))}
            >
              {m.plan_previous()}
            </a>
            <a
              className="rounded-control px-3 py-2 text-body-sm hover:bg-surface-hover"
              href={link(search.vue, '')}
            >
              {m.plan_this_week()}
            </a>
            <a
              className="rounded-control px-3 py-2 text-body-sm hover:bg-surface-hover"
              href={link(search.vue, addDays(days.from, 7))}
            >
              {m.plan_next()}
            </a>
          </nav>
        }
      />
      <nav aria-label={m.plan_scopes()} className="mb-4 flex flex-wrap gap-1">
        {scopes
          .filter(([, , open]) => open)
          .map(([vue, label]) => (
            <a
              key={label}
              href={link(vue)}
              aria-current={search.vue === vue ? 'page' : undefined}
              className="rounded-control border border-line px-3 py-1.5 text-body-sm text-fg aria-[current=page]:border-accent aria-[current=page]:bg-surface-selected"
            >
              {label}
            </a>
          ))}
      </nav>
      {days.conflicts.length > 0 && (
        <ul
          aria-label={m.plan_clashes()}
          className="mb-4 flex list-none flex-col gap-2 rounded-box border border-state-error bg-state-error-surface p-4 text-body-sm text-state-error-fg"
        >
          {days.conflicts.map((clash, index) => (
            <li key={index}>{said(clash)}</li>
          ))}
        </ul>
      )}
      {days.facts.length === 0 && (
        <p className="mb-4 text-body-sm text-fg-muted">{m.plan_empty()}</p>
      )}
      {days.scope === 'me' ? (
        <WeekCalendar days={calendarDays} items={items} allDay={allDay} words={words} />
      ) : (
        <TeamLanes label={words.label} days={calendarDays.slice(0, 5)} rows={rows} />
      )}
    </AppShell>
  );
}
