import { Button, Panel, Tag } from '@kete/design';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { callApi, sendGesture } from '@/platform/api';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';

// The catalogue of agents (spec 104; doctrine D-062, R5): agents Kete and the apps ship, ready to be
// taken — an administrator opens one to everyone; each person takes it for herself.

export interface CatalogueEntry {
  product: string;
  shippedBy: string | null;
  enabled: boolean;
  template: {
    name: string;
    label: { fr: string; en: string };
    mission: { fr: string; en: string };
    sources: string[];
    avatar?: { glyph: string; tint?: string };
  };
}

export const fetchCatalogue = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ entries: CatalogueEntry[]; administrator: boolean }>(
    getRequest(),
    '/v1/agents/catalogue',
  ).catch(() => ({ entries: [] as CatalogueEntry[], administrator: false })),
);

const pathOf = (v: { product?: unknown; name?: unknown }) => {
  if (typeof v.product !== 'string' || !/^[a-z][a-z0-9_]{1,80}$/.test(v.product)) {
    throw new Error('Unknown.');
  }
  if (typeof v.name !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(v.name)) {
    throw new Error('Unknown.');
  }
  return `/v1/agents/catalogue/${v.product}/${v.name}`;
};

export const takeTemplate = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ path: pathOf((input ?? {}) as object) }))
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ agent: { agentId: string } }>(
      getRequest(),
      `${data.path}/take`,
      {},
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, agentId: answer.data.agent.agentId, error: null }
      : { ok: false as const, agentId: null, error: answer.error };
  });

export const enableTemplate = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    path: pathOf((input ?? {}) as object),
    enabled: (input as { enabled?: unknown })?.enabled !== false,
  }))
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `${data.path}/enable`,
      { enabled: data.enabled },
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });

/** Ready agents: hers to take; an administrator opens or closes each for everyone. */
export function AgentCatalogue({
  entries,
  administrator,
}: {
  entries: CatalogueEntry[];
  administrator: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  if (entries.length === 0) return null;
  const words = (w: { fr: string; en: string }) => (getLocale() === 'en' ? w.en : w.fr);
  return (
    <Panel title={m.catalogue_title()}>
      <ul className="m-0 grid list-none gap-3 p-0">
        {entries.map((entry) => (
          <li
            key={`${entry.product}:${entry.template.name}`}
            className="grid gap-1.5 rounded-card border border-line p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{words(entry.template.label)}</span>
              <Tag tone="neutral">{entry.shippedBy ?? m.catalogue_by_kete()}</Tag>
              {administrator && (
                <Tag tone={entry.enabled ? 'validated' : 'neutral'}>
                  {entry.enabled ? m.catalogue_open() : m.catalogue_closed()}
                </Tag>
              )}
            </div>
            <p className="m-0 text-body-sm text-fg-soft">{words(entry.template.mission)}</p>
            <div className="flex flex-wrap gap-2">
              {entry.enabled && (
                <Button
                  onClick={async () => {
                    setNote(null);
                    const answer = await takeTemplate({
                      data: { product: entry.product, name: entry.template.name },
                    });
                    if (!answer.ok) return setNote(refusal(answer.error));
                    await router.navigate({ to: '/mes-agents', search: { agent: answer.agentId } });
                  }}
                >
                  {m.catalogue_take()}
                </Button>
              )}
              {administrator && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    setNote(null);
                    const answer = await enableTemplate({
                      data: {
                        product: entry.product,
                        name: entry.template.name,
                        enabled: !entry.enabled,
                      },
                    });
                    if (!answer.ok) return setNote(refusal(answer.error));
                    await router.invalidate();
                  }}
                >
                  {entry.enabled ? m.catalogue_close() : m.catalogue_open_to_all()}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {note && (
        <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
          {note}
        </p>
      )}
    </Panel>
  );
}
