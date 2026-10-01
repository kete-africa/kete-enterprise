import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { GestureForm, optional, refusal, Select } from './forms';
import { changeRights, type RightsScreen } from './rights';

/** A permission, in the person's words. */
export function permissionLabel(permission: string): string {
  const labels: Record<string, () => string> = {
    'structure:read': m.permission_structure_read,
    'structure:write': m.permission_structure_write,
    'rights:manage': m.permission_rights_manage,
    'registry:read': m.permission_registry_read,
    'registry:review': m.permission_registry_review,
    'decisions:manage': m.permission_decisions_manage,
  };
  return labels[permission]?.() ?? permission;
}

/** What the person may do, and where (everyone sees this part). */
export function MyRights({ screen }: { screen: RightsScreen }) {
  const unitName = new Map(screen.chart.units.map((u) => [u.unitId, u.name]));
  if (screen.reaches.length === 0) return <p className="text-fg-muted">{m.rights_none()}</p>;
  return (
    <ul className="grid gap-2">
      {screen.reaches.map((reach) => (
        <li key={reach.permission} className="flex flex-wrap items-center gap-2">
          <Tag tone="info">{permissionLabel(reach.permission)}</Tag>
          <span className="text-fg-muted">
            {reach.everywhere
              ? m.rights_everywhere()
              : reach.units.map((id) => unitName.get(id) ?? '…').join(', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Roles and grants, for whoever manages rights in the whole organization. */
export function ManageRights({ screen }: { screen: RightsScreen }) {
  const managed = screen.managed;
  const router = useRouter();
  const [role, setRole] = useState({ name: '', permissions: [] as string[] });
  const [grant, setGrant] = useState({
    roleId: '',
    holder: '',
    scope: '',
    startsOn: screen.chart.asOf,
  });
  const [revokeError, setRevokeError] = useState<string | null>(null);
  if (!managed) return null;
  const chart = screen.chart;
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));
  const roleName = new Map(managed.roles.map((r) => [r.roleId, r.name]));
  const positionName = new Map(
    chart.positions.map((p) => [p.positionId, `${p.title} · ${unitName.get(p.unitId) ?? ''}`]),
  );
  const personName = new Map(chart.people.map((p) => [p.personId, p.name]));
  const countries = [...new Set(chart.units.map((u) => u.country).filter((c): c is string => !!c))];

  const scopeOf = (scope: string) =>
    scope.startsWith('unt_')
      ? { scopeUnitId: scope }
      : scope.startsWith('country:')
        ? { scopeCountry: scope.slice('country:'.length) }
        : {};
  const holderOf = (holder: string) =>
    holder.startsWith('pos_') ? { positionId: holder } : { personId: holder };

  return (
    <div className="grid gap-6">
      <Panel title={m.rights_roles()}>
        <ul className="grid gap-2">
          {managed.roles.map((r) => (
            <li key={r.roleId} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              {r.permissions.map((p) => (
                <Tag key={p}>{permissionLabel(p)}</Tag>
              ))}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={m.rights_grants()}>
        <ul className="grid gap-2">
          {managed.grants.map((g) => (
            <li key={g.grantId} className="flex flex-wrap items-center gap-3 text-body-sm">
              <span className="font-semibold">{roleName.get(g.roleId) ?? '…'}</span>
              <span>
                {g.positionId ? positionName.get(g.positionId) : personName.get(g.personId ?? '')}
              </span>
              <span className="text-fg-muted">
                {g.scopeUnitId
                  ? m.rights_scope_unit({ unit: unitName.get(g.scopeUnitId) ?? '…' })
                  : g.scopeCountry
                    ? m.rights_scope_country({ country: g.scopeCountry })
                    : m.rights_everywhere()}
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  setRevokeError(null);
                  void changeRights({
                    data: {
                      path: `/grants/${g.grantId}/revoke`,
                      body: { endsOn: chart.asOf },
                      key: crypto.randomUUID(),
                    },
                  }).then(async (answer) => {
                    if (!answer.ok) return setRevokeError(refusal(answer.error));
                    await router.invalidate();
                  });
                }}
              >
                {m.rights_revoke()}
              </Button>
            </li>
          ))}
        </ul>
        {revokeError && (
          <p role="alert" className="mt-3 text-body-sm text-state-error-fg">
            {revokeError}
          </p>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <GestureForm
          title={m.rights_new_role()}
          ready={role.name.trim() !== ''}
          send={(key) => changeRights({ data: { path: '/roles', body: role, key } })}
          onDone={() => setRole({ name: '', permissions: [] })}
        >
          <TextField
            label={m.field_name()}
            value={role.name}
            required
            onChange={(e) => setRole({ ...role, name: e.target.value })}
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-body-sm font-semibold">{m.rights_permissions()}</legend>
            {managed.permissions.map((p) => (
              <label key={p} className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={role.permissions.includes(p)}
                  onChange={(e) =>
                    setRole({
                      ...role,
                      permissions: e.target.checked
                        ? [...role.permissions, p]
                        : role.permissions.filter((q) => q !== p),
                    })
                  }
                />
                {permissionLabel(p)}
              </label>
            ))}
          </fieldset>
        </GestureForm>

        <GestureForm
          title={m.rights_new_grant()}
          ready={grant.roleId !== '' && grant.holder !== ''}
          send={(key) =>
            changeRights({
              data: {
                path: '/grants',
                body: {
                  roleId: grant.roleId,
                  ...holderOf(grant.holder),
                  ...scopeOf(grant.scope),
                  startsOn: optional(grant.startsOn),
                },
                key,
              },
            })
          }
          onDone={() => setGrant({ ...grant, holder: '' })}
        >
          <Select
            label={m.rights_role()}
            value={grant.roleId}
            required
            onChange={(e) => setGrant({ ...grant, roleId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {managed.roles.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select
            label={m.rights_holder()}
            value={grant.holder}
            required
            onChange={(e) => setGrant({ ...grant, holder: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            <optgroup label={m.rights_positions()}>
              {chart.positions.map((p) => (
                <option key={p.positionId} value={p.positionId}>
                  {positionName.get(p.positionId)}
                </option>
              ))}
            </optgroup>
            <optgroup label={m.rights_people()}>
              {chart.people.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </Select>
          <Select
            label={m.rights_scope()}
            value={grant.scope}
            onChange={(e) => setGrant({ ...grant, scope: e.target.value })}
          >
            <option value="">{m.rights_everywhere()}</option>
            {chart.units.map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {m.rights_scope_unit({ unit: u.name })}
              </option>
            ))}
            {countries.map((c) => (
              <option key={c} value={`country:${c}`}>
                {m.rights_scope_country({ country: c })}
              </option>
            ))}
          </Select>
          <TextField
            label={m.field_starts_on()}
            type="date"
            value={grant.startsOn}
            onChange={(e) => setGrant({ ...grant, startsOn: e.target.value })}
          />
        </GestureForm>
      </div>
    </div>
  );
}
