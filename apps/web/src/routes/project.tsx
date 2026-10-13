import { Button, EmptyState, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { shownMoney } from '@/lib/money';
import { changeProject, fetchProject, type ProjectChange } from '@/lib/projects';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { statusTone, statusWords } from './projects';

export const Route = createFileRoute('/projets/$projectId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchProject({ data: { projectId: params.projectId } }),
  component: ProjectPage,
});

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-body-sm text-fg-muted">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * One project (spec 074): its client, its lead, where it stands; what it was sold for, its budget
 * by post and what it should earn; its team; its thread and files. Its lead, or who manages
 * projects, changes it.
 */
function ProjectPage() {
  const { me } = Route.useRouteContext();
  const project = Route.useLoaderData();
  const router = useRouter();
  const [post, setPost] = useState({ name: '', budget: '' });
  const [colleague, setColleague] = useState('');
  const [sold, setSold] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!project) {
    return (
      <AppShell me={me} current="projects">
        <EmptyState title={m.project_not_found()} />
      </AppShell>
    );
  }
  const projectId = project.projectId;
  const money = (amount: number) => shownMoney(amount, project.currency);
  const mine =
    project.lead.userId === me.userId ||
    me.administrator ||
    me.permissions.includes('projects:manage');
  const open = project.status !== 'closed';

  async function change(data: ProjectChange): Promise<boolean> {
    setPending(true);
    setError(null);
    const answer = await changeProject({ data: { projectId, change: data } });
    setPending(false);
    if (!answer.ok) {
      setError(refusal(answer.error));
      return false;
    }
    await router.invalidate();
    return true;
  }

  return (
    <AppShell me={me} current="projects">
      <PageHeader
        breadcrumbs={[{ label: m.nav_projects(), href: '/projets' }]}
        title={project.name}
        status={<Tag tone={statusTone[project.status]}>{statusWords[project.status]()}</Tag>}
        description={[
          project.party?.name,
          m.project_led_by({ name: project.lead.name }),
          project.phase,
          project.bornFrom
            ? m.project_born_from({ source: project.bornFrom.source, ref: project.bornFrom.ref })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <PageSection first title={m.project_money()}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Fact
            label={m.project_sold()}
            value={project.sold === null ? m.project_not_set() : money(project.sold)}
          />
          <Fact label={m.project_budget()} value={money(project.budget)} />
          <Fact
            label={m.project_margin()}
            value={
              project.expectedMargin === null || !project.sold
                ? m.project_not_set()
                : `${money(project.expectedMargin)} · ${Math.round((project.expectedMargin / project.sold) * 100)} %`
            }
          />
        </div>
        <p className="mt-3 text-body-sm text-fg-muted">{m.project_money_note()}</p>
        {mine && open && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 md:max-w-md"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await change({ kind: 'facts', phase: project.phase ?? '', sold })) setSold('');
            }}
          >
            <div className="min-w-0 flex-1 basis-48">
              <TextField
                label={m.project_sold_set()}
                inputMode="numeric"
                value={sold}
                onChange={(event) => setSold(event.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={pending || !sold.trim()}>
              {m.project_save()}
            </Button>
          </form>
        )}
      </PageSection>
      <PageSection title={m.project_posts()}>
        {project.posts.length === 0 ? (
          <p className="text-fg-muted">{m.project_no_post()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {project.posts.map((line) => (
              <li key={line.postId} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1 basis-48">{line.name}</span>
                <span className="font-semibold tabular-nums">{money(line.budget)}</span>
              </li>
            ))}
          </ul>
        )}
        {mine && open && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 md:max-w-2xl"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await change({ kind: 'post', ...post })) setPost({ name: '', budget: '' });
            }}
          >
            <div className="min-w-0 flex-1 basis-48">
              <TextField
                label={m.project_post_name()}
                value={post.name}
                maxLength={120}
                onChange={(event) => setPost({ ...post, name: event.target.value })}
                required
              />
            </div>
            <div className="min-w-0 flex-1 basis-40">
              <TextField
                label={m.project_post_budget()}
                inputMode="numeric"
                value={post.budget}
                onChange={(event) => setPost({ ...post, budget: event.target.value })}
                required
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={pending || !post.name.trim() || !post.budget.trim()}
            >
              {m.project_post_set()}
            </Button>
          </form>
        )}
      </PageSection>
      <PageSection title={m.project_team()}>
        <ul className="divide-y divide-line">
          {project.team.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 basis-48">{member.name}</span>
              {member.lead ? (
                <Tag tone="info">{m.project_lead()}</Tag>
              ) : (
                mine &&
                open && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      void change({ kind: 'team', colleague: member.userId, on: false })
                    }
                  >
                    {m.project_team_remove()}
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
        {mine && open && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 md:max-w-xl"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await change({ kind: 'team', colleague, on: true })) setColleague('');
            }}
          >
            <div className="min-w-0 flex-1 basis-56">
              <TextField
                label={m.project_team_add()}
                hint={m.requests_colleague_hint()}
                value={colleague}
                onChange={(event) => setColleague(event.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="secondary" disabled={pending || !colleague.trim()}>
              {m.project_team_join()}
            </Button>
          </form>
        )}
        <p className="mt-3 text-body-sm text-fg-muted">{m.project_team_note()}</p>
      </PageSection>
      <PageSection title={m.project_thread()}>
        {me.modules.dossiers ? (
          <a href={`/dossiers/${project.dossierId}`} className="font-semibold text-link underline">
            {m.project_open_thread()}
          </a>
        ) : (
          <p className="text-fg-muted">{m.project_thread_off()}</p>
        )}
      </PageSection>
      {mine && (
        <PageSection title={m.project_state()}>
          <div className="flex flex-wrap gap-2">
            {project.status === 'open' && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => void change({ kind: 'status', status: 'delivered' })}
              >
                {m.project_mark_delivered()}
              </Button>
            )}
            {project.status !== 'closed' ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => void change({ kind: 'status', status: 'closed' })}
              >
                {m.project_close()}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => void change({ kind: 'status', status: 'open' })}
              >
                {m.project_reopen()}
              </Button>
            )}
          </div>
        </PageSection>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </AppShell>
  );
}
