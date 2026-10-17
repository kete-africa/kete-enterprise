import type { SettingLayer, SettingRow } from '@kete/shell';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';
import { getLocale } from '@/paraglide/runtime.js';

// « Réglages » (spec 092): Kete's settings as the API serves them — each with its value and where
// it comes from. Her preferences follow her in every app; the center's and each unit's are set by
// an administrator.

/** A value as it travels to the page: plain JSON. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Words = { fr: string; en: string };

interface SettingView {
  key: string;
  default: Json;
  layers: SettingLayer[];
  label: Words;
  description?: Words;
  choices?: Record<string, Words>;
  group: string;
  schema: { [key: string]: Json };
  value: Json;
  from: SettingLayer;
}

type ScreenRow = Omit<SettingRow, 'schema' | 'value'> & {
  schema: { [key: string]: Json };
  value: Json;
};

/** The rows of the panel: who sets each setting here, in her language. */
function rowsOf(
  settings: SettingView[],
  editable: (view: SettingView) => SettingRow['editable'],
): ScreenRow[] {
  const lang = getLocale() === 'en' ? 'en' : 'fr';
  return settings.map((view) => {
    const layer = editable(view);
    return {
      key: view.key,
      label: view.label[lang],
      ...(view.description ? { description: view.description[lang] } : {}),
      group: view.group,
      schema: view.schema,
      ...(view.choices
        ? {
            choices: Object.fromEntries(
              Object.entries(view.choices).map(([value, words]) => [value, words[lang]]),
            ),
          }
        : {}),
      value: view.value,
      from: view.from,
      ...(layer ? { editable: layer } : {}),
      layers: view.layers,
    };
  });
}

/** Hers and the organization's: her preferences, the center's settings for an administrator. */
export const fetchSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const answer = await callApi<{
    settings: SettingView[];
    personal: boolean;
    administrator: boolean;
  }>(getRequest(), '/v1/settings');
  return {
    administrator: answer.administrator,
    rows: rowsOf(answer.settings, (view) =>
      view.layers.includes('person')
        ? answer.personal
          ? 'person'
          : undefined
        : view.layers.includes('app') && answer.administrator
          ? 'app'
          : undefined,
    ),
  };
});

/** What applies at a unit (a subsidiary, a site): what the unit may set, for an administrator. */
export const fetchUnitSettings = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    unitId: String((input as { unitId?: unknown })?.unitId ?? '').slice(0, 100),
  }))
  .handler(async ({ data }) => {
    const answer = await callApi<{ settings: SettingView[] }>(
      getRequest(),
      `/v1/settings?unitId=${encodeURIComponent(data.unitId)}`,
    );
    return {
      rows: rowsOf(
        answer.settings.filter((view) => view.layers.includes('entity')),
        () => 'entity',
      ),
    };
  });

const change = (input: unknown) => {
  const v = (input ?? {}) as Record<string, unknown>;
  const layer = v.layer === 'app' || v.layer === 'entity' ? v.layer : ('person' as const);
  return {
    key: String(v.key ?? '').slice(0, 120),
    layer,
    ...(typeof v.unitId === 'string' && v.unitId ? { unitId: v.unitId.slice(0, 100) } : {}),
    value: (v.value ?? null) as Json,
  };
};

/** Sets a value: hers in the Compte Kete, the center's or a unit's here. */
export const saveSetting = createServerFn({ method: 'POST' })
  .validator(change)
  .handler(async ({ data }): Promise<GestureAnswer<{ ok: true }>> =>
    sendGesture(getRequest(), '/v1/settings', data, crypto.randomUUID()),
  );

/** Takes a value back to what it inherits. */
export const clearSettingValue = createServerFn({ method: 'POST' })
  .validator(change)
  .handler(async ({ data }): Promise<GestureAnswer<{ ok: true }>> =>
    sendGesture(
      getRequest(),
      '/v1/settings/clear',
      { key: data.key, layer: data.layer, ...(data.unitId ? { unitId: data.unitId } : {}) },
      crypto.randomUUID(),
    ),
  );
