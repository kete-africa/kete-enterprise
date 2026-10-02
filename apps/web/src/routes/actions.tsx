import { Chip, ChipGroup, EmptyState, PageSection, PageTitle } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { fetchActions } from '@/lib/meetings';
import { ActionList } from '@/lib/meetings-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/actions')({
  validateSearch: (search: Record<string, unknown>): { scope?: 'all' } =>
    search['scope'] === 'all' ? { scope: 'all' } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ scope: search.scope }),
  loader: ({ deps }) => fetchActions({ data: { scope: deps.scope ?? 'mine' } }),
  component: ActionsPage,
});

/**
 * The register of actions (spec 013): what meetings decided, what indicators called for, what audits
 * asked — one owner, one deadline, overdue first.
 */
function ActionsPage() {
  const { me } = Route.useRouteContext();
  const register = Route.useLoaderData();
  const navigate = useNavigate({ from: '/actions' });
  const open = register.actions.filter((a) => a.status === 'open');
  const overdue = open.filter((a) => a.overdue).length;
  return (
    <AppShell me={me} current="todo">
      <PageTitle>{m.actions_title()}</PageTitle>
      <p className="text-fg-muted">
        {m.actions_counts({ open: String(open.length), overdue: String(overdue) })}
      </p>
      {register.everything && (
        <div className="mt-3">
          <ChipGroup label={m.actions_scope()}>
            <Chip pressed={register.scope === 'mine'} onClick={() => void navigate({ search: {} })}>
              {m.actions_mine()}
            </Chip>
            <Chip
              pressed={register.scope === 'all'}
              onClick={() => void navigate({ search: { scope: 'all' } })}
            >
              {m.actions_all()}
            </Chip>
          </ChipGroup>
        </div>
      )}
      <PageSection first>
        {register.actions.length === 0 ? (
          <EmptyState title={m.actions_none()} />
        ) : (
          <ActionList
            actions={register.actions}
            personId={me.personId}
            manages={me.administrator || me.permissions.includes('meetings:manage')}
          />
        )}
      </PageSection>
    </AppShell>
  );
}
