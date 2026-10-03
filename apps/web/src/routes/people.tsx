import { Button, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { administer, fetchPeople } from '@/lib/admin';
import { DialogForm, refusal } from '@/lib/forms';
import { administers } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import type { Chart } from '@/lib/structure';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/personnes')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!administers(context.me)) throw redirect({ to: '/' });
    return context;
  },
  loader: () => fetchPeople(),
  component: PeoplePage,
});

type Person = Chart['people'][number];

/** One person: her positions, her account, and the corrections an administrator makes. */
function PersonRow({ person, chart, admin }: { person: Person; chart: Chart; admin: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    name: person.name,
    email: person.email ?? '',
    phone: person.phone ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const titles = chart.assignments
    .filter((a) => a.personId === person.personId)
    .map((a) => chart.positions.find((p) => p.positionId === a.positionId)?.title)
    .filter(Boolean)
    .join(' · ');
  const send = (path: string, body: object) => {
    setError(null);
    void administer({ data: { path, body, key: crypto.randomUUID() } }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      await router.invalidate();
    });
  };
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{person.name}</span>
        {person.accountUserId ? (
          <Tag tone="validated">{m.people_account_linked()}</Tag>
        ) : (
          <Tag>{m.people_link_only()}</Tag>
        )}
        <span className="text-body-sm text-fg-muted">{person.email ?? m.people_no_email()}</span>
      </div>
      {titles && <p className="text-body-sm text-fg-muted">{titles}</p>}
      <div className="flex flex-wrap gap-2">
        <DialogForm
          title={m.people_correct()}
          ready={Boolean(draft.name.trim())}
          onSubmit={() =>
            send(`/structure/people/${person.personId}`, {
              name: draft.name,
              email: draft.email.trim() || null,
              phone: draft.phone.replace(/[\s.-]/g, '') || null,
            })
          }
        >
          <TextField
            label={m.field_name()}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <TextField
            label={m.field_email()}
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
          <TextField
            label={m.field_phone()}
            hint={m.field_phone_hint()}
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </DialogForm>
        {admin && person.accountUserId && (
          <Button
            variant="secondary"
            onClick={() =>
              send(`/structure/people/${person.personId}/account`, { accountUserId: null })
            }
          >
            {m.people_unlink()}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

/** The organization's people (spec 010): who has an account, who is reached by link. */
function PeoplePage() {
  const { me } = Route.useRouteContext();
  const chart = Route.useLoaderData();
  const [filter, setFilter] = useState('');
  const shown = chart.people.filter((p) =>
    `${p.name} ${p.email ?? ''}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const linked = chart.people.filter((p) => p.accountUserId).length;
  return (
    <AppShell me={me} current="people">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_people()}
        actions={
          <a
            href="/administration/personnes/importer"
            className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
          >
            {m.people_import()}
          </a>
        }
      />
      <p className="text-fg-muted">
        {m.people_counts({ people: String(chart.people.length), linked: String(linked) })}
      </p>
      <PageSection first>
        <TextField
          className="max-w-80"
          label={m.people_search()}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="mt-4">
          {shown.map((person) => (
            <PersonRow
              key={person.personId}
              person={person}
              chart={chart}
              admin={me.administrator}
            />
          ))}
        </ul>
      </PageSection>
    </AppShell>
  );
}
