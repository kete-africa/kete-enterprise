import { Button, PageHeader, Panel } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { administer, fetchPeople, type ImportReport } from '@/lib/admin';
import { refusal } from '@/lib/forms';
import { administers } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import type { Chart } from '@/lib/structure';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/personnes/importer')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!administers(context.me)) throw redirect({ to: '/' });
    return context;
  },
  loader: () => fetchPeople(),
  component: ImportPage,
});

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

/** Importing people has its own page (spec 019): a long paste, never beside the list. */
function ImportPage() {
  const { me } = Route.useRouteContext();
  const chart = Route.useLoaderData();
  return (
    <AppShell me={me} current="people">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[
          { label: m.nav_administration(), href: '/administration' },
          { label: m.nav_people(), href: '/administration/personnes' },
        ]}
        title={m.people_import()}
      />
      <div className="max-w-3xl">
        <ImportPeople chart={chart} />
      </div>
    </AppShell>
  );
}
