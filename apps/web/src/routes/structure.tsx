import { PageSection, PageTitle, TextField } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchChart } from '@/lib/structure';
import { StructureForms } from '@/lib/structure-forms';
import { StructureTree } from '@/lib/structure-tree';
import * as m from '@/paraglide/messages.js';

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const Route = createFileRoute('/structure')({
  validateSearch: (search: Record<string, unknown>): { asOf?: string } =>
    isDay(search['asOf']) ? { asOf: search['asOf'] } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ asOf: search.asOf }),
  loader: ({ deps }) => fetchChart({ data: { asOf: deps.asOf } }),
  component: StructurePage,
});

/** The organization at a date, and for its owners and admins, the forms to draw it (spec 002). */
function StructurePage() {
  const chart = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const navigate = useNavigate({ from: '/structure' });
  const canChange = me.role === 'owner' || me.role === 'admin';
  return (
    <AppShell current="structure">
      <PageTitle>{m.structure_title()}</PageTitle>
      <PageSection first>
        <TextField
          className="max-w-56"
          label={m.structure_as_of()}
          type="date"
          value={chart.asOf}
          onChange={(event) => {
            if (isDay(event.target.value)) void navigate({ search: { asOf: event.target.value } });
          }}
        />
        <div className="mt-6">
          <StructureTree chart={chart} />
        </div>
      </PageSection>
      {canChange && (
        <PageSection title={m.structure_draw()}>
          <StructureForms chart={chart} />
        </PageSection>
      )}
    </AppShell>
  );
}
