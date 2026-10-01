import { Tag } from '@kete/design';
import * as m from '@/paraglide/messages.js';
import type { AssignmentKind, Chart } from './structure';

export function kindLabel(kind: AssignmentKind): string {
  const labels: Record<AssignmentKind, () => string> = {
    primary: m.kind_primary,
    functional: m.kind_functional,
    project: m.kind_project,
    interim: m.kind_interim,
    delegation: m.kind_delegation,
  };
  return labels[kind]();
}

/** The organization as a tree: each unit, its positions, and who holds them at the chart's date. */
export function StructureTree({ chart }: { chart: Chart }) {
  const typeName = new Map(chart.unitTypes.map((t) => [t.unitTypeId, t]));
  const personName = new Map(chart.people.map((p) => [p.personId, p.name]));
  const positionTitle = new Map(chart.positions.map((p) => [p.positionId, p.title]));
  const children = (parentId: string | null) =>
    chart.units.filter((unit) =>
      parentId === null
        ? unit.parentId === null || !chart.units.some((u) => u.unitId === unit.parentId)
        : unit.parentId === parentId,
    );

  if (chart.units.length === 0) {
    return <p className="text-fg-muted">{m.structure_empty()}</p>;
  }

  const renderUnit = (unitId: string, name: string, unitTypeId: string, country: string | null) => {
    const type = typeName.get(unitTypeId);
    const positions = chart.positions.filter((p) => p.unitId === unitId);
    const below = children(unitId);
    return (
      <li key={unitId} className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{name}</span>
          {type && <Tag tone={type.legalEntity ? 'info' : 'neutral'}>{type.name}</Tag>}
          {country && <span className="text-body-sm text-fg-muted">{country}</span>}
        </div>
        {positions.length > 0 && (
          <ul className="mt-1 ml-4 grid gap-1 border-l border-line pl-3">
            {positions.map((position) => {
              const holders = chart.assignments.filter((a) => a.positionId === position.positionId);
              return (
                <li key={position.positionId} className="text-body-sm">
                  <span className="text-fg">{position.title}</span>
                  {position.reportsTo && (
                    <span className="text-fg-muted">
                      {' · '}
                      {m.structure_reports_to({
                        title: positionTitle.get(position.reportsTo) ?? '…',
                      })}
                    </span>
                  )}
                  <span className="text-fg-muted">
                    {' · '}
                    {holders.length === 0
                      ? m.structure_vacant()
                      : holders
                          .map(
                            (a) =>
                              `${personName.get(a.personId) ?? '…'} (${kindLabel(a.kind)}${a.endsOn ? ` → ${a.endsOn}` : ''})`,
                          )
                          .join(', ')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {below.length > 0 && (
          <ul className="ml-4 border-l border-line pl-3">
            {below.map((u) => renderUnit(u.unitId, u.name, u.unitTypeId, u.country))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul>{children(null).map((u) => renderUnit(u.unitId, u.name, u.unitTypeId, u.country))}</ul>
  );
}
