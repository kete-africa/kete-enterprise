import { Button, PageSection, PageHeader, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { administer, fetchPeople, type ImportReport } from '@/lib/admin';
import { refusal } from '@/lib/forms';
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
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
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
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
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
          <Button
            onClick={() =>
              send(`/structure/people/${person.personId}`, {
                name: draft.name,
                email: draft.email.trim() || null,
                phone: draft.phone.replace(/[\s.-]/g, '') || null,
              })
            }
          >
            {m.form_save()}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {m.people_correct()}
          </Button>
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
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * A list pasted from a spreadsheet: name, e-mail, phone, position (its title), separated by « ; »
 * or tabs. A title held by several positions goes to the first vacant one.
 */
function parseRows(text: string, chart: Chart) {
  const held = new Set(chart.assignments.map((a) => a.positionId));
  const taken = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|;/).map((cell) => cell.trim()))
    .filter((cells) => cells[0])
    .map(([name = '', email = '', phone = '', title = '']) => {
      const candidates = chart.positions.filter(
        (p) => p.title.toLowerCase() === title.toLowerCase(),
      );
      const position =
        candidates.find((p) => !held.has(p.positionId) && !taken.has(p.positionId)) ??
        candidates[0];
      if (position) taken.add(position.positionId);
      return {
        name,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(title ? { positionId: position?.positionId ?? 'pos_00000000' } : {}),
      };
    });
}

function ImportPeople({ chart }: { chart: Chart }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => parseRows(text, chart), [text, chart]);
  return (
    <Panel title={m.people_import()}>
      <p className="mb-3 text-body-sm text-fg-muted">{m.people_import_explain()}</p>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
        {m.people_import_rows()}
        <textarea
          className="min-h-36 rounded-control border border-line-control bg-surface-control p-3 font-mono text-body-sm font-normal"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={rows.length === 0}
          onClick={() => {
            setError(null);
            void administer({
              data: { path: '/structure/people/import', body: { rows }, key: crypto.randomUUID() },
            }).then(async (answer) => {
              if (!answer.ok) return setError(refusal(answer.error));
              setReport(answer.data);
              setText('');
              await router.invalidate();
            });
          }}
        >
          {m.people_import_send({ count: String(rows.length) })}
        </Button>
        {report && (
          <span className="text-body-sm">
            {m.people_import_report({
              created: String(report.created),
              refused: String(report.refused.length),
            })}
          </span>
        )}
      </div>
      {report && report.refused.length > 0 && (
        <ul className="mt-2 text-body-sm text-state-error-fg">
          {report.refused.map((r) => (
            <li key={r.row}>{m.people_import_refused({ row: String(r.row), code: r.code })}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </Panel>
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
      <PageSection title={m.people_import()}>
        <ImportPeople chart={chart} />
      </PageSection>
    </AppShell>
  );
}
