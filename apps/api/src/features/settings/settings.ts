import {
  clearSetting,
  createAccountSettings,
  defineSettings,
  keteSettings,
  readLayers,
  resolve,
  setSetting,
  settingsHere,
  type AccountSettings,
  type Resolved,
  type SettingDescription,
} from '@kete/settings';
import type { SqlExecutor } from '@kete/tenancy';

// Kete Enterprise's settings (spec 092; kete-core specs 115 to 117; decision 0013 of kete-core;
// doctrine D-060): Kete's own, declared once and resolved by layers — the organization's and the
// person's in the Compte Kete, the center's for the whole organization and each unit's (a
// subsidiary, a site) kept here in `kete_settings`, journaled. A unit is more precise than the
// center: its own value wins there.

export const settingsRegistry = defineSettings(keteSettings);

let account: AccountSettings | undefined;
/** The Compte Kete's two layers, read with the person's token. */
export function accountSettings(): AccountSettings {
  account ??= createAccountSettings({ url: process.env.KETE_ACCOUNT_URL });
  return account;
}

/** Tests: a Compte Kete of their own. */
export function useAccountSettings(client: AccountSettings): void {
  account = client;
}

/** The units from the broadest to the most precise: the root first, the given unit last. */
export async function unitChain(db: SqlExecutor, unitId: string): Promise<string[]> {
  const { rows } = await db.query<{ unit_id: string }>(
    `with recursive up as (
       select unit_id, parent_id, 0 as depth from units where unit_id = $1
       union all
       select u.unit_id, u.parent_id, up.depth + 1 from units u join up on u.unit_id = up.parent_id
         where up.depth < 50)
     select unit_id from up order by depth desc`,
    [unitId],
  );
  return rows.map((row) => row.unit_id);
}

/** A setting as the screen shows it: its declaration, its value and the layer it comes from. */
export interface SettingView extends SettingDescription {
  value: unknown;
  from: string;
}

export function viewsOf(resolved: Resolved): SettingView[] {
  return settingsRegistry.describe().map((d) => ({
    ...d,
    value: resolved.value(d.key),
    from: resolved.from(d.key),
  }));
}

/**
 * The settings as they apply to a person: her preferences over her unit's, the center's and the
 * organization's. With `unitId`, as they apply at that unit, without her own.
 */
export async function settingsFor(
  db: SqlExecutor,
  input: { token: string | null; unitId?: string | null },
): Promise<Resolved> {
  const layers = await accountSettings().read(input.token);
  const entityIds = input.unitId ? await unitChain(db, input.unitId) : [];
  const kept = await readLayers(db, { entityIds });
  return resolve(settingsRegistry, {
    organization: layers.organization,
    ...kept,
    ...(input.unitId ? {} : { person: layers.person }),
  });
}

/**
 * The settings where a command or a job runs, in its organization's transaction: the center's and
 * the unit's over the organization's as one of its members last read it — never a person's own.
 */
export async function settingsIn(
  db: SqlExecutor,
  organizationId: string,
  unitId?: string | null,
): Promise<Resolved> {
  return settingsHere(db, settingsRegistry, {
    organization: accountSettings().organization(organizationId),
    ...(unitId ? { entityIds: await unitChain(db, unitId) } : {}),
  });
}

/** Sets a value on the center's layer (`app`) or a unit's (`entity`); journaled. */
export function setCenterSetting(
  db: SqlExecutor,
  organizationId: string,
  input: { layer: 'app' | 'entity'; unitId?: string; key: string; value: unknown; by: string },
): Promise<unknown> {
  return setSetting(db, organizationId, settingsRegistry, {
    layer: input.layer,
    ...(input.layer === 'entity' && input.unitId ? { scopeId: input.unitId } : {}),
    key: input.key,
    value: input.value,
    by: input.by,
  });
}

/** Takes a value back to what it inherits; journaled. */
export function clearCenterSetting(
  db: SqlExecutor,
  organizationId: string,
  input: { layer: 'app' | 'entity'; unitId?: string; key: string; by: string },
): Promise<boolean> {
  return clearSetting(db, organizationId, {
    layer: input.layer,
    ...(input.layer === 'entity' && input.unitId ? { scopeId: input.unitId } : {}),
    key: input.key,
    by: input.by,
  });
}
