import { PageSection, PageTitle, TextField } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchMyReaches } from '@/lib/rights';
import { fetchChart } from '@/lib/structure';
import { StructureForms } from '@/lib/structure-forms';
import { StructureTree } from '@/lib/structure-tree';
import * as m from '@/paraglide/messages.js';

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const Route = createFileRoute('/administration/organisation')({
  validateSearch: (search: Record<string, unknown>): { asOf?: string } =>
    isDay(search['asOf']) ? { asOf: search['asOf'] } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ asOf: search.asOf }),
  loader: async ({ deps }) => {
    const [chart, reaches] = await Promise.all([
      fetchChart({ data: { asOf: deps.asOf } }),
      fetchMyReaches(),
    ]);
    return { chart, canDraw: reaches.some((r) => r.permission === 'structure:write') };
  },
  component: StructurePage,
});

/** The organization at a date as the person may see it, and the forms for whoever may draw it. */
function StructurePage() {
  const { me } = Route.useRouteContext();
  const { chart, canDraw } = Route.useLoaderData();
  const navigate = useNavigate({ from: '/administration/organisation' });
  return (
    <AppShell me={me} current="organization">
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
      {canDraw && (
        <PageSection title={m.structure_draw()}>
          <StructureForms chart={chart} />
        </PageSection>
      )}
    </AppShell>
  );
}
