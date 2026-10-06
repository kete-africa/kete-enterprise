import { Button, PageHeader, Panel, Tag, TextField, type TagTone } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { DialogForm, refusal, Select } from '@/lib/forms';
import {
  createTrigger,
  createWatch,
  fetchRoutines,
  routineGesture,
  understandRoutine,
  type Family,
  type Proposal,
  type RunStatus,
} from '@/lib/routines';
import {
  createSchedule,
  removeSchedule,
  runSchedule,
  setScheduleActive,
  type Cadence,
  type Schedule,
} from '@/lib/schedules';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/routines')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRoutines(),
  component: RoutinesPage,
});

const weekdays = [
  m.weekday_1,
  m.weekday_2,
  m.weekday_3,
  m.weekday_4,
  m.weekday_5,
  m.weekday_6,
  m.weekday_7,
];
const cadenceWords: Record<Cadence, () => string> = {
  daily: m.schedules_daily,
  weekdays: m.schedules_weekdays,
  weekly: m.schedules_weekly,
};
/** How a task falls, in her words: « Chaque semaine · Vendredi · 16:00 ». */
const whenOf = (s: { cadence: Cadence; weekday: number | null; time: string }) =>
  [
    cadenceWords[s.cadence](),
    ...(s.cadence === 'weekly' && s.weekday ? [weekdays[s.weekday - 1]?.() ?? ''] : []),
    s.time,
  ].join(' · ');

const statusWords: Record<RunStatus, () => string> = {
  queued: m.routines_status_queued,
  running: m.routines_status_running,
  done: m.routines_status_done,
  failed: m.routines_status_failed,
  no_model: m.routines_status_no_model,
  told: m.routines_status_told,
  quiet: m.routines_status_quiet,
};
const statusTone: Record<RunStatus, TagTone> = {
  queued: 'neutral',
  running: 'info',
  done: 'validated',
  failed: 'error',
  no_model: 'verify',
  told: 'info',
  quiet: 'neutral',
};
const familyWords: Record<Family, () => string> = {
  time: m.routines_family_time,
  event: m.routines_family_event,
  watch: m.routines_family_watch,
};

type Gesture = () => Promise<{ ok: boolean; error: string | null }>;

/**
 * Routines (spec 051): what runs for her without her — at a set time, when an app signals, on
 * watch over a figure — written in a sentence, its plan read before it starts, every run kept.
 */
function RoutinesPage() {
  const { me } = Route.useRouteContext();
  const routines = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
  const when = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  const run = (send: Gesture, done?: string) => {
    setBusy(true);
    setNotice(null);
    void send()
      .then(async (answer) => {
        setNotice(
          answer.ok
            ? done
              ? { ok: true, text: done }
              : null
            : { ok: false, text: refusal(answer.error) },
        );
        await router.invalidate();
      })
      .catch(() => setNotice({ ok: false, text: m.error_generic() }))
      .finally(() => setBusy(false));
  };
  const appName = (id: string) => routines.apps.find((a) => a.resourceId === id)?.name ?? id;
  const eventWords = (appId: string, type: string) =>
    routines.apps.find((a) => a.resourceId === appId)?.emits.find((e) => e.type === type)
      ?.description ?? type;
  const figureName = (dashboardId: string, cardId: string) => {
    const board = routines.figures.find((d) => d.dashboardId === dashboardId);
    const card = board?.cards.find((c) => c.id === cardId);
    return board && card ? `${board.name} · ${card.title}` : cardId;
  };
  const locale = getLocale() === 'en' ? 'en' : 'fr';
  return (
    <AppShell me={me} current="routines">
      <PageHeader title={m.routines_title()} description={m.routines_explain()} />
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={notice.ok ? 'text-fg' : 'text-state-error-fg'}
        >
          {notice.text}
        </p>
      )}
      {!me.viewedBy && (
        <NewRoutine
          busy={busy}
          onActivate={(p) =>
            run(() =>
              p.family === 'time'
                ? createSchedule({
                    data: {
                      kind: 'prompt',
                      title: p.title,
                      prompt: p.prompt,
                      cadence: p.cadence,
                      weekday: p.weekday ?? 1,
                      time: p.time,
                      locale,
                    },
                  })
                : p.family === 'event'
                  ? createTrigger({
                      data: {
                        title: p.title,
                        prompt: p.prompt,
                        resourceId: p.resourceId,
                        eventType: p.eventType,
                        locale,
                      },
                    })
                  : createWatch({
                      data: {
                        title: p.title,
                        dashboardId: p.dashboardId,
                        cardId: p.cardId,
                        direction: p.direction,
                        line: p.line,
                        locale,
                      },
                    }),
            )
          }
        />
      )}

      <Family
        title={m.routines_family_time()}
        explain={m.routines_family_time_explain()}
        add={
          <a
            href="/assistant/taches"
            className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
          >
            {m.routines_add_time()}
          </a>
        }
      >
        {routines.schedules.map((s: Schedule) => (
          <RoutineRow
            key={s.scheduleId}
            title={s.title}
            detail={whenOf(s)}
            active={s.active}
            busy={busy || Boolean(me.viewedBy)}
            onTry={() =>
              run(
                () => runSchedule({ data: { scheduleId: s.scheduleId } }),
                m.routines_tried_notice(),
              )
            }
            onActive={(active) =>
              run(() => setScheduleActive({ data: { scheduleId: s.scheduleId, active } }))
            }
            onRemove={() => run(() => removeSchedule({ data: { scheduleId: s.scheduleId } }))}
          />
        ))}
      </Family>

      <Family
        title={m.routines_family_event()}
        explain={m.routines_family_event_explain()}
        add={
          me.viewedBy ? null : routines.apps.some((a) => a.emits.length > 0) ? (
            <EventForm
              busy={busy}
              apps={routines.apps}
              onCreate={(data) => run(() => createTrigger({ data: { ...data, locale } }))}
            />
          ) : (
            <p className="text-body-sm text-fg-muted">{m.routines_no_apps()}</p>
          )
        }
      >
        {routines.triggers.map((t) => (
          <RoutineRow
            key={t.triggerId}
            title={t.title}
            detail={m.routines_on_event({
              app: appName(t.resourceId),
              event: eventWords(t.resourceId, t.eventType),
            })}
            active={t.active}
            busy={busy || Boolean(me.viewedBy)}
            onTry={() =>
              run(
                () => routineGesture({ data: { kind: 'trigger', id: t.triggerId, action: 'try' } }),
                m.routines_tried_notice(),
              )
            }
            onActive={(active) =>
              run(() =>
                routineGesture({
                  data: { kind: 'trigger', id: t.triggerId, action: 'active', active },
                }),
              )
            }
            onRemove={() =>
              run(() =>
                routineGesture({ data: { kind: 'trigger', id: t.triggerId, action: 'remove' } }),
              )
            }
          />
        ))}
      </Family>

      <Family
        title={m.routines_family_watch()}
        explain={m.routines_family_watch_explain()}
        add={
          me.viewedBy ? null : routines.figures.length > 0 ? (
            <WatchForm
              busy={busy}
              figures={routines.figures}
              onCreate={(data) => run(() => createWatch({ data: { ...data, locale } }))}
            />
          ) : (
            <p className="text-body-sm text-fg-muted">{m.routines_no_figures()}</p>
          )
        }
      >
        {routines.watches.map((w) => (
          <RoutineRow
            key={w.watchId}
            title={w.title}
            detail={[
              (w.direction === 'above' ? m.routines_above : m.routines_below)({
                figure: figureName(w.dashboardId, w.cardId),
                line: number.format(w.line),
              }),
              ...(w.lastValue !== null
                ? [m.routines_last_value({ value: number.format(w.lastValue) })]
                : []),
            ].join(' · ')}
            active={w.active}
            busy={busy || Boolean(me.viewedBy)}
            onTry={() =>
              run(
                () => routineGesture({ data: { kind: 'watch', id: w.watchId, action: 'try' } }),
                m.routines_tried_notice(),
              )
            }
            onActive={(active) =>
              run(() =>
                routineGesture({
                  data: { kind: 'watch', id: w.watchId, action: 'active', active },
                }),
              )
            }
            onRemove={() =>
              run(() =>
                routineGesture({ data: { kind: 'watch', id: w.watchId, action: 'remove' } }),
              )
            }
          />
        ))}
      </Family>

      <Panel title={m.routines_history()}>
        {routines.runs.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.routines_history_none()}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="px-2 py-1 font-semibold">{m.routines_when()}</th>
                  <th className="px-2 py-1 font-semibold">{m.routines_what()}</th>
                  <th className="px-2 py-1 font-semibold">{m.routines_cause()}</th>
                  <th className="px-2 py-1 font-semibold">{m.routines_outcome()}</th>
                </tr>
              </thead>
              <tbody>
                {routines.runs.map((r) => (
                  <tr key={r.runId} className="border-t border-line align-top">
                    <td className="px-2 py-2 whitespace-nowrap text-fg-muted">
                      {when(r.createdAt)}
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-semibold">{r.title}</span>
                      <span className="block text-fg-muted">{familyWords[r.family]()}</span>
                    </td>
                    <td className="px-2 py-2">{r.tried ? m.routines_tried() : r.cause}</td>
                    <td className="grid gap-1 px-2 py-2">
                      <Tag tone={statusTone[r.status]}>{statusWords[r.status]()}</Tag>
                      {r.summary && <span className="text-fg-muted">{r.summary}</span>}
                      {r.href && (
                        <a
                          href={r.href}
                          className="font-semibold text-fg underline underline-offset-4"
                        >
                          {m.routines_open()}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}

/** A routine in a sentence: understood, its plan read, then activated — or rephrased. */
function NewRoutine({ busy, onActivate }: { busy: boolean; onActivate: (p: Proposal) => void }) {
  const [sentence, setSentence] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  return (
    <Panel title={m.routines_new()}>
      <div className="grid gap-4">
        <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
          {m.routines_sentence()}
          <textarea
            value={sentence}
            maxLength={1000}
            rows={2}
            onChange={(e) => {
              setSentence(e.target.value);
              setProposal(null);
            }}
            className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal"
          />
          <span className="font-normal text-fg-muted">{m.routines_sentence_hint()}</span>
        </label>
        {!proposal && (
          <div>
            <Button
              disabled={thinking || sentence.trim().length < 3}
              onClick={() => {
                setThinking(true);
                setError(null);
                void understandRoutine({ data: { sentence } })
                  .then((answer) => {
                    if (!answer.ok || !answer.data) return setError(refusal(answer.error));
                    setProposal(answer.data.proposal);
                  })
                  .catch(() => setError(m.error_generic()))
                  .finally(() => setThinking(false));
              }}
            >
              {m.routines_understand()}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-state-error-fg">
            {error}
          </p>
        )}
        {proposal && (
          <div className="grid gap-3 rounded-box border border-line bg-surface-muted p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="info">{familyWords[proposal.family]()}</Tag>
              <span className="font-semibold">{proposal.title}</span>
            </div>
            <p className="text-body-sm font-semibold">{m.routines_plan()}</p>
            <ol className="grid list-decimal gap-1 pl-5 text-body">
              {proposal.plan.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="text-body-sm text-fg-muted">{m.routines_rights()}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  onActivate(proposal);
                  setProposal(null);
                  setSentence('');
                }}
              >
                {m.routines_activate()}
              </Button>
              <Button variant="secondary" onClick={() => setProposal(null)}>
                {m.routines_change()}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Family({
  title,
  explain,
  add,
  children,
}: {
  title: string;
  explain: string;
  add: ReactNode;
  children: ReactNode[];
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-semibold">{title}</h2>
          <p className="text-body-sm text-fg-muted">{explain}</p>
        </div>
        {add}
      </div>
      {children.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{m.routines_none()}</p>
      ) : (
        <ul className="grid rounded-box border border-line">{children}</ul>
      )}
    </section>
  );
}

const actionClass =
  'rounded-control px-2 py-1 text-body-sm font-semibold text-fg hover:bg-surface-hover disabled:opacity-50';

function RoutineRow({
  title,
  detail,
  active,
  busy,
  onTry,
  onActive,
  onRemove,
}: {
  title: string;
  detail: string;
  active: boolean;
  busy: boolean;
  onTry: () => void;
  onActive: (active: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span className="grid min-w-60 flex-1">
        <span className="flex items-center gap-2 font-semibold">
          {title}
          {!active && <Tag>{m.routines_paused()}</Tag>}
        </span>
        <span className="text-body-sm text-fg-muted">{detail}</span>
      </span>
      <span className="flex flex-wrap gap-1">
        <button type="button" className={actionClass} disabled={busy} onClick={onTry}>
          {m.routines_try()}
        </button>
        <button
          type="button"
          className={actionClass}
          disabled={busy}
          onClick={() => onActive(!active)}
        >
          {active ? m.routines_pause() : m.routines_resume()}
        </button>
        <button type="button" className={actionClass} disabled={busy} onClick={onRemove}>
          {m.routines_remove()}
        </button>
      </span>
    </li>
  );
}

function EventForm({
  busy,
  apps,
  onCreate,
}: {
  busy: boolean;
  apps: { resourceId: string; name: string; emits: { type: string; description: string }[] }[];
  onCreate: (data: {
    title: string;
    prompt: string;
    resourceId: string;
    eventType: string;
  }) => void;
}) {
  const empty = { title: '', prompt: '', resourceId: '', eventType: '' };
  const [draft, setDraft] = useState(empty);
  const app = apps.find((a) => a.resourceId === draft.resourceId);
  return (
    <DialogForm
      title={m.routines_add_event()}
      busy={busy}
      ready={Boolean(
        draft.title.trim() && draft.prompt.trim() && draft.resourceId && draft.eventType,
      )}
      onSubmit={() => {
        onCreate(draft);
        setDraft(empty);
      }}
    >
      <TextField
        label={m.routines_name()}
        value={draft.title}
        maxLength={120}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <Select
        label={m.routines_app()}
        value={draft.resourceId}
        onChange={(e) => setDraft({ ...draft, resourceId: e.target.value, eventType: '' })}
      >
        <option value="" />
        {apps
          .filter((a) => a.emits.length > 0)
          .map((a) => (
            <option key={a.resourceId} value={a.resourceId}>
              {a.name}
            </option>
          ))}
      </Select>
      <Select
        label={m.routines_event()}
        value={draft.eventType}
        onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}
      >
        <option value="" />
        {(app?.emits ?? []).map((e) => (
          <option key={e.type} value={e.type}>
            {e.description}
          </option>
        ))}
      </Select>
      <TextField
        label={m.routines_instruction()}
        value={draft.prompt}
        maxLength={2000}
        onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
      />
    </DialogForm>
  );
}

function WatchForm({
  busy,
  figures,
  onCreate,
}: {
  busy: boolean;
  figures: { dashboardId: string; name: string; cards: { id: string; title: string }[] }[];
  onCreate: (data: {
    title: string;
    dashboardId: string;
    cardId: string;
    direction: 'above' | 'below';
    line: number;
  }) => void;
}) {
  const empty = { title: '', figure: '', direction: 'above' as 'above' | 'below', line: '' };
  const [draft, setDraft] = useState(empty);
  const line = Number(draft.line.replace(',', '.'));
  const [dashboardId, cardId] = draft.figure.split('|');
  return (
    <DialogForm
      title={m.routines_add_watch()}
      busy={busy}
      ready={Boolean(
        draft.title.trim() && dashboardId && cardId && draft.line.trim() && Number.isFinite(line),
      )}
      onSubmit={() => {
        if (!dashboardId || !cardId) return;
        onCreate({ title: draft.title, dashboardId, cardId, direction: draft.direction, line });
        setDraft(empty);
      }}
    >
      <TextField
        label={m.routines_name()}
        value={draft.title}
        maxLength={120}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <Select
        label={m.routines_figure()}
        value={draft.figure}
        onChange={(e) => setDraft({ ...draft, figure: e.target.value })}
      >
        <option value="" />
        {figures.flatMap((d) =>
          d.cards.map((c) => (
            <option key={`${d.dashboardId}|${c.id}`} value={`${d.dashboardId}|${c.id}`}>
              {`${d.name} · ${c.title}`}
            </option>
          )),
        )}
      </Select>
      <Select
        label={m.routines_direction()}
        value={draft.direction}
        onChange={(e) =>
          setDraft({ ...draft, direction: e.target.value === 'below' ? 'below' : 'above' })
        }
      >
        <option value="above">{m.routines_direction_above()}</option>
        <option value="below">{m.routines_direction_below()}</option>
      </Select>
      <TextField
        label={m.routines_line()}
        inputMode="decimal"
        value={draft.line}
        onChange={(e) => setDraft({ ...draft, line: e.target.value })}
      />
    </DialogForm>
  );
}
