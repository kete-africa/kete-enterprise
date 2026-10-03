import { AppCard, AppGrid, Icon, PageHeader, PageSection, Row, RowList, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchInbox } from '@/lib/decisions';
import { DraftCard } from '@/lib/draft-card';
import { fetchDrafts, fetchTasks } from '@/lib/workspace';
import { InboxView } from '@/lib/decisions-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchActions, fetchMeetings } from '@/lib/meetings';
import { ActionList, NoteCard } from '@/lib/meetings-view';
import { fetchMySurveys } from '@/lib/surveys';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/a-faire')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ context }) => {
    const [tasks, drafts, inbox, surveys, actions, meetings] = await Promise.all([
      fetchTasks().catch(() => ({ tasks: [] })),
      fetchDrafts().catch(() => ({ drafts: [] })),
      fetchInbox(),
      context.me.modules.surveys ? fetchMySurveys() : Promise.resolve({ surveys: [] }),
      fetchActions({ data: { scope: 'mine' } }),
      context.me.modules.meetings ? fetchMeetings() : Promise.resolve(null),
    ]);
    return {
      tasks: tasks.tasks,
      drafts: drafts.drafts,
      inbox,
      surveys: surveys.surveys,
      actions: actions.actions.filter((a) => a.status === 'open'),
      notes: (meetings?.notes ?? []).filter((n) => n.status === 'published' && !n.readByMe),
    };
  },
  component: InboxPage,
});

/**
 * Everything that waits for the person (spec 010): the forms she must fill in (spec 011), the
 * decisions she must take and her own requests (spec 005).
 */
function InboxPage() {
  const { me } = Route.useRouteContext();
  const { tasks, drafts, inbox, surveys, actions, notes } = Route.useLoaderData();
  const when = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  const waiting = surveys.filter((s) => s.status !== 'submitted');
  return (
    <AppShell me={me} current="todo">
      <PageHeader title={m.inbox_title()} />
      {drafts.length > 0 && (
        <PageSection first title={m.inbox_drafts()}>
          <p className="mb-4 text-fg-muted">{m.inbox_drafts_explain()}</p>
          <div className="grid gap-4">
            {drafts.map((d) => (
              <DraftCard key={d.draftId} draft={d} />
            ))}
          </div>
        </PageSection>
      )}
      {tasks.length > 0 && (
        <PageSection first={drafts.length === 0} title={m.inbox_app_tasks()}>
          <RowList label={m.inbox_app_tasks()}>
            {tasks.map((task) => (
              <Row
                key={task.taskId}
                href={task.href}
                title={task.title}
                meta={[task.source, task.dueAt ? m.inbox_task_due({ at: when(task.dueAt) }) : null]
                  .filter(Boolean)
                  .join(' · ')}
                end={task.overdue && <Tag tone="error">{m.actions_overdue()}</Tag>}
              />
            ))}
          </RowList>
        </PageSection>
      )}
      {waiting.length > 0 && (
        <PageSection
          first={drafts.length === 0 && tasks.length === 0}
          title={m.todo_forms({ count: String(waiting.length) })}
        >
          <AppGrid layout="list">
            {waiting.map((s) => (
              <AppCard
                key={s.respondentId}
                href={`/enquetes/repondre/${s.respondentId}`}
                icon={<Icon name="teach" />}
                name={s.title}
                description={m.todo_form_detail({
                  period: s.period,
                  done: String(s.formsSubmitted),
                  total: String(s.formsTotal),
                  closes: s.closesOn,
                })}
              />
            ))}
          </AppGrid>
        </PageSection>
      )}
      {notes.length > 0 && (
        <PageSection
          first={waiting.length === 0}
          title={m.todo_notes({ count: String(notes.length) })}
        >
          <div className="grid gap-3">
            {notes.map((n) => (
              <NoteCard key={n.noteId} note={n} publishes={false} />
            ))}
          </div>
        </PageSection>
      )}
      {actions.length > 0 && (
        <PageSection
          first={waiting.length === 0 && notes.length === 0}
          title={m.todo_actions({ count: String(actions.length) })}
        >
          <ActionList actions={actions} personId={me.personId} manages={false} />
          <p className="mt-2 text-body-sm">
            <a className="text-link underline" href="/actions">
              {m.todo_all_actions()}
            </a>
          </p>
        </PageSection>
      )}
      <PageSection
        first={waiting.length === 0 && notes.length === 0 && actions.length === 0}
        title={m.todo_decisions()}
      >
        <InboxView screen={{ ...inbox, circuits: null }} />
      </PageSection>
    </AppShell>
  );
}
