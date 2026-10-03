import { Button, PageSection, PageHeader, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPeople } from '@/lib/admin';
import { DialogForm, Select } from '@/lib/forms';
import { fetchMeeting } from '@/lib/meetings';
import { dateTime, meetingStatusLabel, useMeetingGesture } from '@/lib/meetings-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/instances/$meetingId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => {
    const [screen, chart] = await Promise.all([
      fetchMeeting({ data: { meetingId: params.meetingId } }),
      fetchPeople(),
    ]);
    return { ...screen, chart };
  },
  component: MeetingPage,
});

/**
 * One meeting (spec 013): its agenda drawn from the gaps, who was present and the quorum, its
 * decisions — each with an owner and a deadline becomes an action — and its record.
 */
function MeetingPage() {
  const { me } = Route.useRouteContext();
  const { meeting, manages, chart } = Route.useLoaderData();
  const { busy, run, notice } = useMeetingGesture();
  const [item, setItem] = useState('');
  const [present, setPresent] = useState<string[]>(meeting.presentPersonIds);
  const [decision, setDecision] = useState({
    text: '',
    responsiblePersonId: '',
    dueOn: '',
    idea: false,
  });
  const [notes, setNotes] = useState(meeting.notes ?? '');
  const base = `/meetings/meetings/${meeting.meetingId}`;
  const people = chart.people;
  const kindLabel = (kind: string) =>
    kind === 'red_indicators'
      ? m.agenda_red()
      : kind === 'overdue_action'
        ? m.agenda_overdue()
        : m.agenda_manual();
  return (
    <AppShell me={me} current="meetings">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_meetings(), href: '/instances' }]}
        title={meeting.title}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={meeting.status === 'recorded' ? 'validated' : 'info'}>
          {meetingStatusLabel(meeting.status)}
        </Tag>
        <span className="text-body-sm text-fg-muted">{dateTime(meeting.startsAt)}</span>
        {meeting.quorumMet === true && <Tag tone="validated">{m.meeting_quorum_met()}</Tag>}
        {meeting.quorumMet === false && <Tag tone="error">{m.meeting_quorum_missed()}</Tag>}
        {meeting.onTime === true && <Tag tone="validated">{m.meeting_record_on_time()}</Tag>}
        {meeting.onTime === false && <Tag tone="error">{m.meeting_record_late()}</Tag>}
      </div>
      <PageSection first title={m.agenda_title()}>
        <Panel>
          <ol className="grid gap-2">
            {meeting.agenda.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-2">
                <Tag
                  tone={
                    a.kind === 'red_indicators'
                      ? 'error'
                      : a.kind === 'overdue_action'
                        ? 'verify'
                        : 'neutral'
                  }
                >
                  {kindLabel(a.kind)}
                </Tag>
                <span className="font-semibold">{a.title}</span>
                {a.detail && <span className="text-body-sm text-fg-muted">{a.detail}</span>}
              </li>
            ))}
          </ol>
          {manages && meeting.status !== 'recorded' && (
            <div className="mt-3">
              <DialogForm
                title={m.agenda_add()}
                busy={busy}
                ready={Boolean(item.trim())}
                onSubmit={() =>
                  run(`${base}/agenda`, { title: item }, () => {
                    setItem('');
                    return undefined;
                  })
                }
              >
                <TextField
                  label={m.agenda_add()}
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                />
              </DialogForm>
            </div>
          )}
        </Panel>
      </PageSection>
      {manages && meeting.status === 'planned' && (
        <PageSection title={m.meeting_attendance()}>
          <DialogForm
            title={m.meeting_attendance()}
            label={m.meeting_hold()}
            trigger="primary"
            busy={busy}
            ready={present.length > 0}
            onSubmit={() => run(`${base}/hold`, { presentPersonIds: present })}
          >
            <div className="grid gap-1">
              {people.map((p) => (
                <label key={p.personId} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={present.includes(p.personId)}
                    onChange={(e) =>
                      setPresent(
                        e.target.checked
                          ? [...present, p.personId]
                          : present.filter((x) => x !== p.personId),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </DialogForm>
        </PageSection>
      )}
      <PageSection title={m.decisions_title()}>
        <div className="grid gap-3">
          <ul className="grid gap-2">
            {meeting.decisions.map((d) => (
              <li
                key={d.decisionId}
                className="rounded-box border border-line bg-surface px-4 py-3"
              >
                <p className="font-semibold">{d.text}</p>
                <p className="text-body-sm text-fg-muted">
                  {d.idea
                    ? m.decision_idea()
                    : d.responsibleName
                      ? m.decision_owner({ name: d.responsibleName, due: d.dueOn ?? '' })
                      : m.decision_no_owner()}
                </p>
              </li>
            ))}
          </ul>
          {manages && meeting.status === 'held' && (
            <div>
              <DialogForm
                title={m.decision_new()}
                busy={busy}
                ready={Boolean(decision.text.trim())}
                onSubmit={() =>
                  run(
                    `${base}/decisions`,
                    {
                      text: decision.text,
                      idea: decision.idea,
                      ...(decision.responsiblePersonId && decision.dueOn
                        ? {
                            responsiblePersonId: decision.responsiblePersonId,
                            dueOn: decision.dueOn,
                          }
                        : {}),
                    },
                    () => {
                      setDecision({ text: '', responsiblePersonId: '', dueOn: '', idea: false });
                      return undefined;
                    },
                  )
                }
              >
                <TextField
                  label={m.decision_text()}
                  value={decision.text}
                  onChange={(e) => setDecision({ ...decision, text: e.target.value })}
                />
                <Select
                  label={m.decision_owner_field()}
                  value={decision.responsiblePersonId}
                  onChange={(e) =>
                    setDecision({ ...decision, responsiblePersonId: e.target.value })
                  }
                >
                  <option value="">{m.field_nobody()}</option>
                  {people.map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <TextField
                  label={m.decision_due()}
                  type="date"
                  value={decision.dueOn}
                  onChange={(e) => setDecision({ ...decision, dueOn: e.target.value })}
                />
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={decision.idea}
                    onChange={(e) => setDecision({ ...decision, idea: e.target.checked })}
                  />
                  {m.decision_is_idea()}
                </label>
              </DialogForm>
            </div>
          )}
        </div>
      </PageSection>
      <PageSection title={m.meeting_record()}>
        {meeting.status === 'recorded' ? (
          <Panel>
            <p className="whitespace-pre-line">{meeting.notes || '—'}</p>
          </Panel>
        ) : manages && meeting.status === 'held' ? (
          <DialogForm
            title={m.meeting_record()}
            label={m.meeting_publish()}
            trigger="primary"
            busy={busy}
            ready
            onSubmit={() =>
              run(`${base}/publish`, { notes }, (d) =>
                d.onTime ? m.meeting_record_on_time() : m.meeting_record_late(),
              )
            }
          >
            <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
              {m.meeting_record_notes()}
              <textarea
                className="min-h-48 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </DialogForm>
        ) : (
          <p className="text-body-sm text-fg-muted">{m.meeting_record_waiting()}</p>
        )}
        {notice}
      </PageSection>
    </AppShell>
  );
}
