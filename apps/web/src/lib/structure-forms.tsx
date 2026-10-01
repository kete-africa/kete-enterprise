import { TextField } from '@kete/design';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { GestureForm, optional, Select } from './forms';
import { assignmentKinds, changeStructure, type Chart } from './structure';
import { kindLabel } from './structure-tree';

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
        ready={type.key.length > 1 && type.name.trim() !== ''}
        send={(key) => changeStructure({ data: { path: '/unit-types', body: type, key } })}
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
        ready={unit.unitTypeId !== '' && unit.name.trim() !== ''}
        send={(key) =>
          changeStructure({
            data: {
              path: '/units',
              body: {
                unitTypeId: unit.unitTypeId,
                name: unit.name,
                parentId: optional(unit.parentId),
                country: optional(unit.country.toUpperCase()),
                startsOn: optional(unit.startsOn),
              },
              key,
            },
          })
        }
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
        ready={position.unitId !== '' && position.title.trim() !== ''}
        send={(key) =>
          changeStructure({
            data: {
              path: '/positions',
              body: {
                unitId: position.unitId,
                title: position.title,
                reportsTo: optional(position.reportsTo),
              },
              key,
            },
          })
        }
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
        ready={person.name.trim() !== ''}
        send={(key) =>
          changeStructure({
            data: {
              path: '/people',
              body: {
                name: person.name,
                email: optional(person.email),
                phone: optional(person.phone),
              },
              key,
            },
          })
        }
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
        ready={
          assignment.personId !== '' && assignment.positionId !== '' && assignment.startsOn !== ''
        }
        send={(key) =>
          changeStructure({
            data: {
              path: '/assignments',
              body: {
                personId: assignment.personId,
                positionId: assignment.positionId,
                kind: assignment.kind,
                startsOn: assignment.startsOn,
                endsOn: optional(assignment.endsOn),
              },
              key,
            },
          })
        }
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
