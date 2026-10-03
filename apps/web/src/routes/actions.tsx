import {
  Button,
  Chip,
  ChipGroup,
  CommandBar,
  Drawer,
  EmptyState,
  KpiGrid,
  KpiTile,
  PageHeader,
  Row,
  RowList,
  Tag,
  TextField,
  ViewSwitcher,
} from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPeople } from '@/lib/admin';
import { fetchActions, type Action } from '@/lib/meetings';
import { ActionList, useMeetingGesture } from '@/lib/meetings-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

type View = 'liste' | 'colonnes';

export const Route = createFileRoute('/actions')({
  validateSearch: (search: Record<string, unknown>): { scope?: 'all'; vue?: View } => ({
    ...(search['scope'] === 'all' ? { scope: 'all' as const } : {}),
    ...(search['vue'] === 'colonnes' ? { vue: 'colonnes' as const } : {}),
  }),
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ scope: search.scope }),
  loader: async ({ deps, context }) => {
    const manages = context.me.administrator || context.me.permissions.includes('meetings:manage');
    const [register, people] = await Promise.all([
      fetchActions({ data: { scope: deps.scope ?? 'mine' } }),
      manages ? fetchPeople().catch(() => null) : Promise.resolve(null),
    ]);
    return {
      register,
      manages,
      people: (people?.people ?? []).map((p) => ({ personId: p.personId, name: p.name })),
    };
  },
  component: ActionsPage,
});

/**
 * The register of actions (spec 013, 016): what meetings decided, what indicators called for, what
 * audits asked — one owner, one deadline, overdue first; as a list or in columns by state. A new
 * action opens in a side panel.
 */
function ActionsPage() {
  const { me } = Route.useRouteContext();
  const { register, manages, people } = Route.useLoaderData();
  const search = Route.useSearch();
  const view: View = search.vue ?? 'liste';
  const navigate = useNavigate({ from: '/actions' });
  const [adding, setAdding] = useState(false);
  const open = register.actions.filter((a) => a.status === 'open');
  const overdue = open.filter((a) => a.overdue);
  const closed = register.actions.filter((a) => a.status !== 'open');
  const href = (vue: View) =>
    `/actions?${new URLSearchParams({ ...(search.scope ? { scope: search.scope } : {}), vue }).toString()}`;
  const column = (title: string, actions: Action[]) => (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="flex items-center gap-2 font-semibold">
        {title}
        <Tag>{String(actions.length)}</Tag>
      </h2>
      <RowList label={title}>
        {actions.map((a) => (
          <Row
            key={a.actionId}
            title={a.title}
            meta={[a.responsibleName, a.dueOn].filter(Boolean).join(' · ')}
          />
        ))}
      </RowList>
    </section>
  );
  return (
    <AppShell me={me} current="todo">
      <PageHeader
        title={m.actions_title()}
        description={m.actions_explain()}
        actions={manages && <Button onClick={() => setAdding(true)}>{m.actions_new()}</Button>}
      />
      <KpiGrid label={m.actions_title()}>
        <KpiTile label={m.actions_open()} value={open.length} />
        <KpiTile label={m.actions_overdue()} value={overdue.length} />
        <KpiTile label={m.actions_closed()} value={closed.length} />
      </KpiGrid>
      <CommandBar
        end={
          <ViewSwitcher
            label={m.common_format()}
            value={view}
            options={[
              { key: 'liste', label: m.view_list(), icon: 'list', href: href('liste') },
              { key: 'colonnes', label: m.view_columns(), icon: 'columns', href: href('colonnes') },
            ]}
          />
        }
      >
        {register.everything && (
          <ChipGroup label={m.actions_scope()}>
            <Chip
              pressed={register.scope === 'mine'}
              onClick={() => void navigate({ search: search.vue ? { vue: search.vue } : {} })}
            >
              {m.actions_mine()}
            </Chip>
            <Chip
              pressed={register.scope === 'all'}
              onClick={() => void navigate({ search: { ...search, scope: 'all' } })}
            >
              {m.actions_all()}
            </Chip>
          </ChipGroup>
        )}
      </CommandBar>
      {register.actions.length === 0 ? (
        <EmptyState title={m.actions_none()} />
      ) : view === 'liste' ? (
        <ActionList actions={register.actions} personId={me.personId} manages={manages} />
      ) : (
        <div className="grid gap-5 min-[1101px]:grid-cols-3">
          {column(m.actions_overdue(), overdue)}
          {column(
            m.actions_open(),
            open.filter((a) => !a.overdue),
          )}
          {column(m.actions_closed(), closed)}
        </div>
      )}
      {manages && <NewAction open={adding} onClose={() => setAdding(false)} people={people} />}
    </AppShell>
  );
}

/** A manual action, in the side panel: a title, an owner, a deadline; it can be cancelled. */
function NewAction({
  open,
  onClose,
  people,
}: {
  open: boolean;
  onClose: () => void;
  people: { personId: string; name: string }[];
}) {
  const { busy, run, notice } = useMeetingGesture();
  const [draft, setDraft] = useState({ title: '', detail: '', responsiblePersonId: '', dueOn: '' });
  const ready = draft.title.trim() && draft.responsiblePersonId && draft.dueOn;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={m.actions_new()}
      closeLabel={m.common_close()}
      footer={
        <>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              run(
                '/actions',
                {
                  title: draft.title,
                  responsiblePersonId: draft.responsiblePersonId,
                  dueOn: draft.dueOn,
                  ...(draft.detail.trim() ? { detail: draft.detail } : {}),
                },
                () => {
                  setDraft({ title: '', detail: '', responsiblePersonId: '', dueOn: '' });
                  onClose();
                  return undefined;
                },
              )
            }
          >
            {m.actions_create()}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {m.common_cancel()}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextField
          label={m.actions_field_title()}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
          {m.actions_field_owner()}
          <select
            className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal"
            value={draft.responsiblePersonId}
            onChange={(e) => setDraft({ ...draft, responsiblePersonId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {people.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={m.actions_field_due()}
          type="date"
          value={draft.dueOn}
          onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })}
        />
        <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
          {m.actions_field_detail()}
          <textarea
            className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
            value={draft.detail}
            onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
          />
        </label>
        {notice}
      </div>
    </Drawer>
  );
}
