import {
  Button,
  EmptyState,
  PageHeader,
  PageSection,
  Tag,
  TextField,
  type TagTone,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { shownMoney } from '@/lib/money';
import { fetchFunds } from '@/lib/project-money';
import { createProject, fetchProjects, type Project } from '@/lib/projects';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/projets')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [listed, funds] = await Promise.all([fetchProjects(), fetchFunds()]);
    return { ...listed, funds };
  },
  component: ProjectsPage,
});

export const statusWords: Record<Project['status'], () => string> = {
  open: m.project_status_open,
  delivered: m.project_status_delivered,
  closed: m.project_status_closed,
};
export const statusTone: Record<Project['status'], TagTone> = {
  open: 'info',
  delivered: 'validated',
  closed: 'neutral',
};

/**
 * Projects (spec 074, doctrine D-047): what the organization works on. She sees those she belongs
 * to — or all of them, when she reads them all. A project is born from a sentence: a name.
 */
function ProjectsPage() {
  const { me } = Route.useRouteContext();
  const { projects, manages, funds } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AppShell me={me} current="projects">
      <PageHeader title={m.nav_projects()} description={m.projects_explain()} />
      {manages && (
        <PageSection first title={m.projects_new()}>
          <form
            className="flex flex-wrap items-end gap-2 md:max-w-2xl"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              const answer = await createProject({ data: { name } });
              setPending(false);
              if (!answer.ok) return setError(refusal(answer.error));
              setName('');
              await router.navigate({ to: `/projets/${answer.projectId}` });
            }}
          >
            <div className="min-w-0 flex-1 basis-72">
              <TextField
                label={m.projects_name()}
                hint={m.projects_name_hint()}
                value={name}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={pending || !name.trim()}>
              {m.projects_create()}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </PageSection>
      )}
      <PageSection first={!manages} title={m.projects_list()}>
        {projects.length === 0 ? (
          <EmptyState title={m.projects_none()} />
        ) : (
          <ul className="divide-y divide-line">
            {projects.map((project) => (
              <li key={project.projectId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <a
                    href={`/projets/${project.projectId}`}
                    className="font-semibold text-link underline"
                  >
                    {project.name}
                  </a>
                  <p className="text-body-sm text-fg-muted">
                    {[
                      project.party?.name,
                      m.project_led_by({ name: project.lead.name }),
                      project.phase,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {project.budget > 0 && (
                  <span className="text-body-sm tabular-nums text-fg-muted">
                    {m.project_budget_of({ amount: shownMoney(project.budget, project.currency) })}
                  </span>
                )}
                <Tag tone={statusTone[project.status]}>{statusWords[project.status]()}</Tag>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      {funds && funds.projects.length > 0 && (
        <PageSection title={m.funds_title()}>
          <p className="mb-3 text-body-sm text-fg-muted">
            {m.funds_explain({
              reserved: shownMoney(funds.organization.reserved, funds.organization.currency),
              committed: shownMoney(funds.organization.committed, funds.organization.currency),
            })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-line text-fg-muted">
                  <th className="py-2 pe-3 text-start font-normal">{m.nav_projects()}</th>
                  <th className="py-2 pe-3 text-end font-normal">{m.money_received()}</th>
                  <th className="py-2 pe-3 text-end font-normal">{m.money_committed()}</th>
                  <th className="py-2 pe-3 text-end font-normal">{m.money_spent()}</th>
                  <th className="py-2 text-end font-normal">{m.money_available()}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {funds.projects.map((line) => (
                  <tr key={line.projectId}>
                    <td className="py-2 pe-3">
                      <a href={`/projets/${line.projectId}`} className="text-link underline">
                        {line.name}
                      </a>
                    </td>
                    {[line.money.received, line.money.committed, line.money.spent].map(
                      (amount, index) => (
                        <td
                          key={index}
                          className="whitespace-nowrap py-2 pe-3 text-end tabular-nums"
                        >
                          {shownMoney(amount, line.money.currency)}
                        </td>
                      ),
                    )}
                    <td
                      className={`whitespace-nowrap py-2 text-end font-semibold tabular-nums ${line.money.short > 0 ? 'text-state-error-fg' : ''}`}
                    >
                      {shownMoney(line.money.available, line.money.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {funds.organization.shortProjects > 0 && (
            <p className="mt-3 text-body-sm text-state-error-fg">
              {m.funds_short({ count: String(funds.organization.shortProjects) })}
            </p>
          )}
        </PageSection>
      )}
    </AppShell>
  );
}
