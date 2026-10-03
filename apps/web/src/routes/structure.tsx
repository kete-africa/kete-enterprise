import {
  Button,
  CommandBar,
  DataTable,
  DetailPane,
  Drawer,
  Facts,
  KpiGrid,
  KpiTile,
  OrgChart,
  PageHeader,
  SplitView,
  Tag,
  TextField,
  ViewSwitcher,
  type ChartNode,
} from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchMyReaches } from '@/lib/rights';
import { fetchChart, type Chart } from '@/lib/structure';
import { StructureForms } from '@/lib/structure-forms';
import { kindLabel, StructureTree } from '@/lib/structure-tree';
import * as m from '@/paraglide/messages.js';

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

type View = 'organigramme' | 'arborescence' | 'tableau';
const views: View[] = ['organigramme', 'arborescence', 'tableau'];

export const Route = createFileRoute('/administration/organisation')({
  validateSearch: (search: Record<string, unknown>): { asOf?: string; vue?: View } => ({
    ...(isDay(search['asOf']) ? { asOf: search['asOf'] } : {}),
    ...(views.includes(search['vue'] as View) ? { vue: search['vue'] as View } : {}),
  }),
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

/** Who holds a position at the chart's date, with the kind of each assignment. */
function holdersOf(chart: Chart, positionId: string) {
  const names = new Map(chart.people.map((p) => [p.personId, p.name]));
  return chart.assignments
    .filter((a) => a.positionId === positionId)
    .map((a) => ({ name: names.get(a.personId) ?? '—', kind: a.kind }));
}

/** The positions as an organization chart: each box a position, under the one it reports to. */
function chartNodes(chart: Chart): ChartNode[] {
  const ids = new Set(chart.positions.map((p) => p.positionId));
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));
  const node = (positionId: string): ChartNode => {
    const position = chart.positions.find((p) => p.positionId === positionId);
    const holders = holdersOf(chart, positionId);
    return {
      id: positionId,
      title: position?.title ?? '—',
      subtitle: holders.length
        ? holders.map((h) => h.name).join(', ')
        : (unitName.get(position?.unitId ?? '') ?? ''),
      ...(holders.length === 0 ? { badge: <Tag tone="verify">{m.structure_vacant()}</Tag> } : {}),
      children: chart.positions
        .filter((p) => p.reportsTo === positionId)
        .map((p) => node(p.positionId)),
    };
  };
  return chart.positions
    .filter((p) => !p.reportsTo || !ids.has(p.reportsTo))
    .map((p) => node(p.positionId));
}

/**
 * The organization at a date, in three formats — the chart of positions, the tree of units, the
 * table of positions — with the selected position in the detail pane; drawing it opens a panel.
 */
function StructurePage() {
  const { me } = Route.useRouteContext();
  const { chart, canDraw } = Route.useLoaderData();
  const search = Route.useSearch();
  const view: View = search.vue ?? 'organigramme';
  const navigate = useNavigate({ from: '/administration/organisation' });
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));
  const titleOf = new Map(chart.positions.map((p) => [p.positionId, p.title]));
  const vacant = chart.positions.filter((p) => holdersOf(chart, p.positionId).length === 0);
  const position = chart.positions.find((p) => p.positionId === selected) ?? null;
  const href = (vue: View) =>
    `/administration/organisation?${new URLSearchParams({
      ...(search.asOf ? { asOf: search.asOf } : {}),
      vue,
    }).toString()}`;

  return (
    <AppShell me={me} current="organization">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.structure_title()}
        description={m.structure_explain()}
        actions={canDraw && <Button onClick={() => setDrawing(true)}>{m.structure_draw()}</Button>}
      />
      <KpiGrid label={m.structure_title()}>
        <KpiTile label={m.structure_units()} value={chart.units.length} />
        <KpiTile label={m.structure_positions()} value={chart.positions.length} />
        <KpiTile label={m.structure_people()} value={chart.people.length} />
        <KpiTile label={m.structure_vacancies()} value={vacant.length} />
      </KpiGrid>
      <CommandBar
        end={
          <ViewSwitcher
            label={m.common_format()}
            value={view}
            options={[
              {
                key: 'organigramme',
                label: m.structure_view_chart(),
                icon: 'chart',
                href: href('organigramme'),
              },
              {
                key: 'arborescence',
                label: m.structure_view_tree(),
                icon: 'list',
                href: href('arborescence'),
              },
              {
                key: 'tableau',
                label: m.structure_view_table(),
                icon: 'table',
                href: href('tableau'),
              },
            ]}
          />
        }
      >
        <TextField
          className="max-w-48"
          label={m.structure_as_of()}
          type="date"
          value={chart.asOf}
          onChange={(event) => {
            if (isDay(event.target.value))
              void navigate({ search: { ...search, asOf: event.target.value } });
          }}
        />
      </CommandBar>
      <SplitView
        detail={
          position && (
            <DetailPane
              title={position.title}
              subtitle={unitName.get(position.unitId)}
              closeLabel={m.common_close()}
              onClose={() => setSelected(null)}
            >
              <Facts
                items={[
                  {
                    label: m.structure_holder(),
                    value: holdersOf(chart, position.positionId).length ? (
                      <ul className="grid gap-1">
                        {holdersOf(chart, position.positionId).map((h, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2">
                            {h.name}
                            {h.kind !== 'primary' && <Tag>{kindLabel(h.kind)}</Tag>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Tag tone="verify">{m.structure_vacant()}</Tag>
                    ),
                  },
                  {
                    label: m.structure_reports_to_label(),
                    value: position.reportsTo ? (titleOf.get(position.reportsTo) ?? '—') : '—',
                  },
                  {
                    label: m.structure_reports(),
                    value: chart.positions.filter((p) => p.reportsTo === position.positionId)
                      .length,
                  },
                  { label: m.structure_since(), value: position.startsOn },
                ]}
              />
            </DetailPane>
          )
        }
      >
        {chart.units.length === 0 ? (
          <p className="text-fg-muted">{m.structure_empty()}</p>
        ) : view === 'organigramme' ? (
          <OrgChart
            label={m.structure_view_chart()}
            root={chartNodes(chart)}
            selected={selected}
            onSelect={setSelected}
            foldLabel={m.structure_fold()}
            unfoldLabel={m.structure_unfold()}
          />
        ) : view === 'arborescence' ? (
          <StructureTree chart={chart} />
        ) : (
          <DataTable
            caption={m.structure_view_table()}
            rows={chart.positions}
            rowKey={(p) => p.positionId}
            onRowClick={(p) => setSelected(p.positionId)}
            selected={selected}
            columns={[
              { key: 'title', label: m.structure_position() },
              {
                key: 'unit',
                label: m.structure_unit(),
                render: (p) => unitName.get(p.unitId) ?? '—',
              },
              {
                key: 'holder',
                label: m.structure_holder(),
                render: (p) => {
                  const holders = holdersOf(chart, p.positionId);
                  return holders.length ? (
                    holders.map((h) => h.name).join(', ')
                  ) : (
                    <Tag tone="verify">{m.structure_vacant()}</Tag>
                  );
                },
              },
              {
                key: 'reportsTo',
                label: m.structure_reports_to_label(),
                render: (p) => (p.reportsTo ? (titleOf.get(p.reportsTo) ?? '—') : '—'),
              },
            ]}
          />
        )}
      </SplitView>
      {canDraw && (
        <Drawer
          open={drawing}
          onClose={() => setDrawing(false)}
          title={m.structure_draw()}
          closeLabel={m.common_close()}
        >
          <StructureForms chart={chart} />
        </Drawer>
      )}
    </AppShell>
  );
}
