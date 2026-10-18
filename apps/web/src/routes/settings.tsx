import { PageHeader, PageSection } from '@kete/design';
import {
  SettingsPanel,
  type EditableLayer,
  type SettingLayer,
  type SettingResult,
  type SettingsWords,
} from '@kete/shell';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Select } from '@/lib/forms';
import { clearSettingValue, fetchSettings, fetchUnitSettings, saveSetting } from '@/lib/settings';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchChart } from '@/lib/structure';
import * as m from '@/paraglide/messages.js';

// « Réglages » (spec 092; kete-core specs 115 and 116): the same panel as in every Kete app — her
// preferences, which follow her everywhere; the center's settings for the whole organization; and,
// for an administrator, what a unit (a subsidiary, a site) sets for itself.
export const Route = createFileRoute('/reglages')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const settings = await fetchSettings();
    const units = settings.administrator
      ? (await fetchChart({ data: {} })).units
          .filter((unit) => unit.endsOn === null)
          .map((unit) => ({ unitId: unit.unitId, name: unit.name }))
      : [];
    return { ...settings, units };
  },
  component: SettingsPage,
});

const groups: Record<string, () => string> = {
  identity: m.settings_group_identity,
  language: m.settings_group_language,
  notifications: m.settings_group_notifications,
  calendar: m.settings_group_calendar,
  display: m.settings_group_display,
  agents: m.settings_group_agents,
};
const layers: Record<SettingLayer, () => string> = {
  kete: m.settings_from_kete,
  organization: m.settings_from_organization,
  app: m.settings_from_center,
  entity: m.settings_from_unit,
  person: m.settings_from_person,
  device: m.settings_from_device,
};
const parts: Record<string, () => string> = { from: m.settings_part_from, to: m.settings_part_to };
const refusals: Record<string, () => string> = {
  invalid_value: m.settings_refused_value,
  forbidden: m.settings_refused_forbidden,
  not_connected: m.settings_refused_alone,
  unreachable: m.settings_refused_unreachable,
};

const words = (): SettingsWords => ({
  mine: m.settings_mine(),
  mineHint: m.settings_mine_hint(),
  organization: m.settings_organization(),
  organizationHint: m.settings_organization_hint(),
  group: (group) => groups[group]?.() ?? group,
  from: (layer) => layers[layer](),
  inherit: m.settings_inherit(),
  none: m.settings_none(),
  yes: m.settings_yes(),
  no: m.settings_no(),
  part: (name) => parts[name]?.() ?? name,
  // The organization's own are set in the Compte Kete; a unit's below, on this page.
  elsewhere: (row) =>
    row.layers?.includes('app') ? m.settings_by_admin() : m.settings_in_account(),
  saving: m.settings_saving(),
  saved: m.settings_saved(),
  failed: (code) => (refusals[code] ?? m.settings_refused)(),
});

const said = (answer: { ok: true } | { ok: false; error: string }): SettingResult =>
  answer.ok ? { ok: true } : { ok: false, error: answer.error };

function SettingsPage() {
  const { me } = Route.useRouteContext();
  const { rows, units, administrator } = Route.useLoaderData();
  const router = useRouter();
  const [unitId, setUnitId] = useState('');
  const [unitRows, setUnitRows] = useState<
    Awaited<ReturnType<typeof fetchUnitSettings>>['rows'] | null
  >(null);

  async function loadUnit(id: string) {
    setUnitId(id);
    setUnitRows(id ? (await fetchUnitSettings({ data: { unitId: id } })).rows : null);
  }
  const save = async (key: string, layer: EditableLayer, value: unknown) => {
    const answer = said(
      await saveSetting({
        data: { key, layer, value, ...(layer === 'entity' ? { unitId } : {}) },
      }),
    );
    if (answer.ok) {
      if (layer === 'entity') await loadUnit(unitId);
      else await router.invalidate();
    }
    return answer;
  };
  const clear = async (key: string, layer: EditableLayer) => {
    const answer = said(
      await clearSettingValue({
        data: { key, layer, ...(layer === 'entity' ? { unitId } : {}) },
      }),
    );
    if (answer.ok) {
      if (layer === 'entity') await loadUnit(unitId);
      else await router.invalidate();
    }
    return answer;
  };

  return (
    <AppShell me={me} current="settings">
      <PageHeader title={m.settings_title()} description={m.settings_intro()} />
      <div className="flex max-w-[860px] flex-col gap-6">
        <SettingsPanel rows={rows} words={words()} onSave={save} onClear={clear} />
        {administrator && units.length > 0 && (
          <PageSection title={m.settings_unit_title()}>
            <p className="mb-4 text-body-sm text-fg-muted">{m.settings_unit_hint()}</p>
            <div className="mb-4 max-w-sm">
              <Select
                label={m.settings_unit_choice()}
                value={unitId}
                onChange={(event) => void loadUnit(event.currentTarget.value)}
              >
                <option value="">{m.settings_unit_none()}</option>
                {units.map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </div>
            {unitRows && (
              <SettingsPanel
                key={unitId}
                rows={unitRows}
                words={{
                  ...words(),
                  organization: m.settings_unit_panel(),
                  organizationHint: m.settings_unit_panel_hint(),
                }}
                onSave={save}
                onClear={clear}
              />
            )}
          </PageSection>
        )}
      </div>
    </AppShell>
  );
}
