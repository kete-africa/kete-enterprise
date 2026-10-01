import { Button, Panel, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import * as m from '@/paraglide/messages.js';
import { assignmentKinds, changeStructure, type Chart } from './structure';
import { kindLabel } from './structure-tree';

/** A refusal of the API, in the person's words. */
function refusal(code: string): string {
  const messages: Record<string, () => string> = {
    forbidden: m.error_forbidden,
    cycle: m.error_cycle,
    closed: m.error_closed,
    primary_overlap: m.error_primary_overlap,
    ends_before_start: m.error_ends_before_start,
    not_found: m.error_not_found,
    invalid_input: m.error_invalid_input,
  };
  return (messages[code] ?? m.error_generic)();
}

function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
      {label}
      <select
        className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal text-fg"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

/** One form: it sends one gesture, with its own idempotency key, then reloads the chart. */
function GestureForm({
  title,
  path,
  body,
  ready,
  onDone,
  children,
}: {
  title: string;
  path: string;
  body: () => object;
  ready: boolean;
  onDone: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={title}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          changeStructure({ data: { path, body: body(), key: crypto.randomUUID() } })
            .then(async (answer) => {
              if (!answer.ok) return setError(refusal(answer.error ?? 'internal'));
              onDone();
              await router.invalidate();
            })
            .catch(() => setError(m.error_generic()))
            .finally(() => setBusy(false));
        }}
      >
        {children}
        {error && (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !ready}>
          {m.form_save()}
        </Button>
      </form>
    </Panel>
  );
}

const optional = (value: string) => (value.trim() ? value.trim() : undefined);

/** The forms that draw the organization (owners and admins). */
export function StructureForms({ chart }: { chart: Chart }) {
  const [type, setType] = useState({ key: '', name: '', legalEntity: false });
  const [unit, setUnit] = useState({
    unitTypeId: '',
    parentId: '',
    name: '',
    country: '',
    startsOn: '',
  });
  const [position, setPosition] = useState({ unitId: '', title: '', reportsTo: '' });
  const [person, setPerson] = useState({ name: '', email: '', phone: '' });
  const [assignment, setAssignment] = useState({
    personId: '',
    positionId: '',
    kind: 'primary',
    startsOn: chart.asOf,
    endsOn: '',
  });
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <GestureForm
        title={m.form_unit_type()}
        path="/unit-types"
        ready={type.key.length > 1 && type.name.trim() !== ''}
        body={() => type}
        onDone={() => setType({ key: '', name: '', legalEntity: false })}
      >
        <TextField
          label={m.field_name()}
          value={type.name}
          required
          onChange={(e) => setType({ ...type, name: e.target.value })}
        />
        <TextField
          label={m.field_key()}
          hint={m.field_key_hint()}
          value={type.key}
          pattern="[a-z][a-z0-9_]+"
          required
          onChange={(e) => setType({ ...type, key: e.target.value })}
        />
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={type.legalEntity}
            onChange={(e) => setType({ ...type, legalEntity: e.target.checked })}
          />
          {m.field_legal_entity()}
        </label>
      </GestureForm>

      <GestureForm
        title={m.form_unit()}
        path="/units"
        ready={unit.unitTypeId !== '' && unit.name.trim() !== ''}
        body={() => ({
          unitTypeId: unit.unitTypeId,
          name: unit.name,
          parentId: optional(unit.parentId),
          country: optional(unit.country.toUpperCase()),
          startsOn: optional(unit.startsOn),
        })}
        onDone={() => setUnit({ ...unit, name: '', country: '' })}
      >
        <Select
          label={m.field_unit_type()}
          value={unit.unitTypeId}
          required
          onChange={(e) => setUnit({ ...unit, unitTypeId: e.target.value })}
        >
          <option value="">{m.field_choose()}</option>
          {chart.unitTypes.map((t) => (
            <option key={t.unitTypeId} value={t.unitTypeId}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select
          label={m.field_parent()}
          value={unit.parentId}
          onChange={(e) => setUnit({ ...unit, parentId: e.target.value })}
        >
          <option value="">{m.field_top()}</option>
          {chart.units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {u.name}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_name()}
          value={unit.name}
          required
          onChange={(e) => setUnit({ ...unit, name: e.target.value })}
        />
        <TextField
          label={m.field_country()}
          hint={m.field_country_hint()}
          value={unit.country}
          maxLength={2}
          onChange={(e) => setUnit({ ...unit, country: e.target.value })}
        />
        <TextField
          label={m.field_starts_on()}
          type="date"
          value={unit.startsOn}
          onChange={(e) => setUnit({ ...unit, startsOn: e.target.value })}
        />
      </GestureForm>

      <GestureForm
        title={m.form_position()}
        path="/positions"
        ready={position.unitId !== '' && position.title.trim() !== ''}
        body={() => ({
          unitId: position.unitId,
          title: position.title,
          reportsTo: optional(position.reportsTo),
        })}
        onDone={() => setPosition({ ...position, title: '' })}
      >
        <Select
          label={m.field_unit()}
          value={position.unitId}
          required
          onChange={(e) => setPosition({ ...position, unitId: e.target.value })}
        >
          <option value="">{m.field_choose()}</option>
          {chart.units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {u.name}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_title()}
          value={position.title}
          required
          onChange={(e) => setPosition({ ...position, title: e.target.value })}
        />
        <Select
          label={m.field_reports_to()}
          value={position.reportsTo}
          onChange={(e) => setPosition({ ...position, reportsTo: e.target.value })}
        >
          <option value="">{m.field_nobody()}</option>
          {chart.positions.map((p) => (
            <option key={p.positionId} value={p.positionId}>
              {`${p.title} · ${unitName.get(p.unitId) ?? ''}`}
            </option>
          ))}
        </Select>
      </GestureForm>

      <GestureForm
        title={m.form_person()}
        path="/people"
        ready={person.name.trim() !== ''}
        body={() => ({
          name: person.name,
          email: optional(person.email),
          phone: optional(person.phone),
        })}
        onDone={() => setPerson({ name: '', email: '', phone: '' })}
      >
        <TextField
          label={m.field_name()}
          value={person.name}
          required
          onChange={(e) => setPerson({ ...person, name: e.target.value })}
        />
        <TextField
          label={m.field_email()}
          type="email"
          value={person.email}
          onChange={(e) => setPerson({ ...person, email: e.target.value })}
        />
        <TextField
          label={m.field_phone()}
          hint={m.field_phone_hint()}
          type="tel"
          value={person.phone}
          onChange={(e) => setPerson({ ...person, phone: e.target.value })}
        />
      </GestureForm>

      <GestureForm
        title={m.form_assignment()}
        path="/assignments"
        ready={
          assignment.personId !== '' && assignment.positionId !== '' && assignment.startsOn !== ''
        }
        body={() => ({
          personId: assignment.personId,
          positionId: assignment.positionId,
          kind: assignment.kind,
          startsOn: assignment.startsOn,
          endsOn: optional(assignment.endsOn),
        })}
        onDone={() => setAssignment({ ...assignment, personId: '', endsOn: '' })}
      >
        <Select
          label={m.field_person()}
          value={assignment.personId}
          required
          onChange={(e) => setAssignment({ ...assignment, personId: e.target.value })}
        >
          <option value="">{m.field_choose()}</option>
          {chart.people.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          label={m.field_position()}
          value={assignment.positionId}
          required
          onChange={(e) => setAssignment({ ...assignment, positionId: e.target.value })}
        >
          <option value="">{m.field_choose()}</option>
          {chart.positions.map((p) => (
            <option key={p.positionId} value={p.positionId}>
              {`${p.title} · ${unitName.get(p.unitId) ?? ''}`}
            </option>
          ))}
        </Select>
        <Select
          label={m.field_kind()}
          value={assignment.kind}
          onChange={(e) => setAssignment({ ...assignment, kind: e.target.value })}
        >
          {assignmentKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_starts_on()}
          type="date"
          value={assignment.startsOn}
          required
          onChange={(e) => setAssignment({ ...assignment, startsOn: e.target.value })}
        />
        <TextField
          label={m.field_ends_on()}
          type="date"
          value={assignment.endsOn}
          onChange={(e) => setAssignment({ ...assignment, endsOn: e.target.value })}
        />
      </GestureForm>
    </div>
  );
}
