import { EmptyState, PageHeader, Row, RowList, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { DialogForm, refusal, Select } from '@/lib/forms';
import {
  createSchedule,
  fetchSchedules,
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

export const Route = createFileRoute('/assistant/taches')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchSchedules(),
  component: SchedulesPage,
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

/** How a task falls, in her words: « Chaque semaine · Lundi · 08:00 ». */
const describe = (s: Schedule) =>
  [
    cadenceWords[s.cadence](),
    ...(s.cadence === 'weekly' && s.weekday ? [weekdays[s.weekday - 1]?.() ?? ''] : []),
    s.time,
  ].join(' · ');

const actionClass =
  'rounded-control px-2 py-1 text-body-sm font-semibold text-fg hover:bg-surface-hover disabled:opacity-50';

/**
 * Her scheduled tasks (spec 029): her morning briefing, or a question her assistant answers at a
 * set time with her rights. She adds one in a dialog, runs it at once, pauses or removes it.
 */
function SchedulesPage() {
  const { me } = Route.useRouteContext();
  const { schedules } = Route.useLoaderData();
  const router = useRouter();
  const empty = {
    kind: 'prompt' as 'briefing' | 'prompt',
    title: '',
    prompt: '',
    cadence: 'weekdays' as Cadence,
    weekday: 1,
    time: '08:00',
    byEmail: false,
  };
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const when = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  const gesture = (send: () => Promise<{ ok: boolean; error: string | null }>, done?: string) => {
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
  const ready =
    draft.title.trim() !== '' && (draft.kind === 'briefing' || draft.prompt.trim() !== '');
  return (
    <AppShell me={me} current="assistant">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_assistant(), href: '/assistant' }]}
        title={m.schedules_title()}
        description={m.schedules_explain()}
        actions={
          <DialogForm
            title={m.schedules_new()}
            trigger="primary"
            busy={busy}
            ready={ready}
            onSubmit={() =>
              gesture(async () => {
                const answer = await createSchedule({
                  data: {
                    ...draft,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    locale: getLocale(),
                  },
                });
                if (answer.ok) setDraft(empty);
                return answer;
              })
            }
          >
            <Select
              label={m.schedules_kind()}
              value={draft.kind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  kind: e.target.value as 'briefing' | 'prompt',
                  title:
                    e.target.value === 'briefing' && !draft.title
                      ? m.schedules_kind_briefing()
                      : draft.title,
                })
              }
            >
              <option value="prompt">{m.schedules_kind_prompt()}</option>
              <option value="briefing">{m.schedules_kind_briefing()}</option>
            </Select>
            <TextField
              label={m.schedules_name()}
              value={draft.title}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            {draft.kind === 'prompt' && (
              <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
                {m.schedules_prompt()}
                <textarea
                  className="min-h-28 rounded-control border border-line-control bg-surface-control p-3 font-normal text-fg"
                  value={draft.prompt}
                  maxLength={2000}
                  placeholder={m.schedules_prompt_hint()}
                  onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                />
              </label>
            )}
            <Select
              label={m.schedules_cadence()}
              value={draft.cadence}
              onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Cadence })}
            >
              {(['daily', 'weekdays', 'weekly'] as const).map((c) => (
                <option key={c} value={c}>
                  {cadenceWords[c]()}
                </option>
              ))}
            </Select>
            {draft.cadence === 'weekly' && (
              <Select
                label={m.schedules_weekday()}
                value={String(draft.weekday)}
                onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
              >
                {weekdays.map((day, index) => (
                  <option key={index} value={index + 1}>
                    {day()}
                  </option>
                ))}
              </Select>
            )}
            <TextField
              label={m.schedules_time()}
              type="time"
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
            />
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={draft.byEmail}
                onChange={(e) => setDraft({ ...draft, byEmail: e.target.checked })}
              />
              {m.schedules_by_email()}
            </label>
          </DialogForm>
        }
      />
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`text-body-sm ${notice.ok ? 'text-fg-muted' : 'text-state-error-fg'}`}
        >
          {notice.text}
        </p>
      )}
      {schedules.length === 0 ? (
        <EmptyState title={m.schedules_none()} />
      ) : (
        <RowList label={m.schedules_title()}>
          {schedules.map((s) => (
            <Row
              key={s.scheduleId}
              title={s.title}
              meta={`${describe(s)} — ${
                s.active ? m.schedules_next({ when: when(s.nextRunAt) }) : m.schedules_paused()
              }`}
              end={
                <>
                  {s.lastStatus === 'failed' && <Tag tone="error">{m.schedules_failed()}</Tag>}
                  {s.lastStatus === 'no_model' && <Tag tone="verify">{m.schedules_no_model()}</Tag>}
                  <button
                    type="button"
                    disabled={busy}
                    className={actionClass}
                    onClick={() =>
                      gesture(
                        () => runSchedule({ data: { scheduleId: s.scheduleId } }),
                        s.kind === 'briefing' ? m.schedules_ran_briefing() : m.schedules_ran(),
                      )
                    }
                  >
                    {m.schedules_run()}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={actionClass}
                    onClick={() =>
                      gesture(() =>
                        setScheduleActive({
                          data: { scheduleId: s.scheduleId, active: !s.active },
                        }),
                      )
                    }
                  >
                    {s.active ? m.schedules_pause() : m.schedules_resume()}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={actionClass}
                    onClick={() =>
                      gesture(() => removeSchedule({ data: { scheduleId: s.scheduleId } }))
                    }
                  >
                    {m.schedules_remove()}
                  </button>
                </>
              }
            />
          ))}
        </RowList>
      )}
    </AppShell>
  );
}
