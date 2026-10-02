import { Button, EmptyState, PageSection, PageTitle, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPeople } from '@/lib/admin';
import { Select } from '@/lib/forms';
import { opens } from '@/lib/me';
import { fetchMeetings } from '@/lib/meetings';
import { dateTime, meetingStatusLabel, NoteCard, useMeetingGesture } from '@/lib/meetings-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/instances')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!opens(context.me, 'meetings', ['meetings:manage', 'meetings:publish'])) {
      throw redirect({ to: '/' });
    }
    return context;
  },
  loader: async () => {
    const [screen, chart] = await Promise.all([fetchMeetings(), fetchPeople()]);
    return { ...screen, chart };
  },
  component: MeetingsPage,
});

/**
 * Meetings (spec 013), for the secretariat and the DG: the meetings — planned from their type, with
 * an agenda drawn from the gaps — and the decision notes.
 */
function MeetingsPage() {
  const { me } = Route.useRouteContext();
  const { types, meetings, notes, manages, publishes, chart } = Route.useLoaderData();
  const { busy, run, notice } = useMeetingGesture();
  const [plan, setPlan] = useState({ typeId: types[0]?.typeId ?? '', startsAt: '' });
  const [note, setNote] = useState({ subject: '', body: '', signedByPersonId: me.personId ?? '' });
  return (
    <AppShell me={me} current="meetings">
      <PageTitle>{m.nav_meetings()}</PageTitle>
      <p className="text-fg-muted">{m.meetings_explain()}</p>
      {manages && (
        <PageSection first title={m.meetings_list()}>
          {meetings.length === 0 ? (
            <EmptyState title={m.meetings_none()} />
          ) : (
            <ul className="grid gap-2">
              {meetings.map((mt) => (
                <li key={mt.meetingId}>
                  <a
                    href={`/instances/${mt.meetingId}`}
                    className="flex flex-wrap items-center gap-3 rounded-box border border-line bg-surface px-4 py-3 hover:border-accent"
                  >
                    <span className="font-semibold">{mt.title}</span>
                    <Tag tone={mt.status === 'recorded' ? 'validated' : 'info'}>
                      {meetingStatusLabel(mt.status)}
                    </Tag>
                    <span className="text-body-sm text-fg-muted">{dateTime(mt.startsAt)}</span>
                    {mt.onTime === false && <Tag tone="error">{m.meeting_record_late()}</Tag>}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Panel title={m.meeting_plan()}>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label={m.meeting_type()}
                  value={plan.typeId}
                  onChange={(e) => setPlan({ ...plan, typeId: e.target.value })}
                >
                  {types.map((t) => (
                    <option key={t.typeId} value={t.typeId}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <TextField
                  label={m.meeting_when()}
                  type="datetime-local"
                  value={plan.startsAt}
                  onChange={(e) => setPlan({ ...plan, startsAt: e.target.value })}
                />
                <Button
                  disabled={busy || !plan.typeId || !plan.startsAt}
                  onClick={() =>
                    run(
                      '/meetings/meetings',
                      { typeId: plan.typeId, startsAt: new Date(plan.startsAt).toISOString() },
                      (d) => m.meeting_planned_done({ items: String(d.agenda ?? 0) }),
                    )
                  }
                >
                  {m.meeting_plan_action()}
                </Button>
              </div>
              {notice}
            </Panel>
          </div>
        </PageSection>
      )}
      {manages && (
        <PageSection title={m.meetings_types()}>
          <ul className="grid gap-2">
            {types.map((t) => (
              <li
                key={t.typeId}
                className="flex flex-wrap items-center gap-2 rounded-box border border-line bg-surface px-4 py-3"
              >
                <span className="font-semibold">{t.name}</span>
                <span className="text-body-sm text-fg-muted">{t.cadence}</span>
                {t.quorum && (
                  <Tag>
                    {m.meeting_quorum({
                      quorum: String(t.quorum),
                      members: String(t.memberPositionIds.length),
                    })}
                  </Tag>
                )}
                <Tag>{m.meeting_record_within({ hours: String(t.recordWithinHours) })}</Tag>
              </li>
            ))}
          </ul>
        </PageSection>
      )}
      <PageSection first={!manages} title={m.notes_title()}>
        <div className="grid gap-3">
          {notes.map((n) => (
            <NoteCard key={n.noteId} note={n} publishes={publishes} />
          ))}
          {publishes && (
            <Panel title={m.note_new()}>
              <div className="grid gap-3">
                <TextField
                  label={m.note_subject()}
                  value={note.subject}
                  onChange={(e) => setNote({ ...note, subject: e.target.value })}
                />
                <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
                  {m.note_body()}
                  <textarea
                    className="min-h-40 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                    value={note.body}
                    onChange={(e) => setNote({ ...note, body: e.target.value })}
                  />
                </label>
                <Select
                  label={m.note_signatory()}
                  value={note.signedByPersonId}
                  onChange={(e) => setNote({ ...note, signedByPersonId: e.target.value })}
                >
                  <option value="">{m.field_choose()}</option>
                  {chart.people.map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <div>
                  <Button
                    disabled={busy || !note.subject || !note.body || !note.signedByPersonId}
                    onClick={() => run('/meetings/notes', note, () => m.note_drafted())}
                  >
                    {m.note_draft_action()}
                  </Button>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </PageSection>
    </AppShell>
  );
}
