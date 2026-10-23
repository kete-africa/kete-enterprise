import { ActorAvatar, Button, Panel, Tag, type ActorTint } from '@kete/design';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { callApi, sendGesture } from '@/platform/api';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';

// The catalogue of agents (spec 104; doctrine D-062, R5): agents Kete and the apps ship, ready to be
// taken — an administrator opens one to everyone; each person takes it for herself. Drawn as canvas
// v7's « Agents livrés »: a card per agent with its face, its sources, what wakes it and what it
// takes on, grouped by who ships it.

type Words = { fr: string; en: string };
export type Wake =
  | { kind: 'state'; object: Words; state: Words }
  | { kind: 'event'; event: string }
  | { kind: 'routine'; time: string };

export interface CatalogueEntry {
  product: string;
  shippedBy: string | null;
  enabled: boolean;
  template: {
    name: string;
    label: { fr: string; en: string };
    mission: { fr: string; en: string };
    sources: string[];
    take_on?: 'never' | 'propose' | 'alone';
    avatar?: { glyph: string; tint?: string };
  };
  wakes: Wake[];
}

export const fetchCatalogue = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ entries: CatalogueEntry[]; apps: Record<string, string>; administrator: boolean }>(
    getRequest(),
    '/v1/agents/catalogue',
  ).catch(() => ({
    entries: [] as CatalogueEntry[],
    apps: {} as Record<string, string>,
    administrator: false,
  })),
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

/** Kete's own sources, in words; an app's product by its name. */
const KETE_SOURCES: Record<string, () => string> = {
  kete: m.colleague_source_kete,
  knowledge: m.colleague_source_knowledge,
  team_data: m.colleague_source_team_data,
  forms: m.colleague_source_forms,
  documents: m.colleague_source_documents,
  dashboards: m.colleague_source_dashboards,
};
const TAKE_ON = {
  never: m.colleague_never,
  propose: m.colleague_proposes,
  alone: m.colleague_alone,
};

/** Ready agents: hers to take; an administrator opens or closes each for everyone. */
export function AgentCatalogue({
  entries,
  apps,
  administrator,
}: {
  entries: CatalogueEntry[];
  apps: Record<string, string>;
  administrator: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  if (entries.length === 0) return null;
  const words = (w: Words) => (getLocale() === 'en' ? w.en : w.fr);
  const wakeWords = (wake: Wake) =>
    wake.kind === 'routine'
      ? m.catalogue_wake_routine({ time: wake.time })
      : wake.kind === 'state'
        ? m.catalogue_wake_state({ object: words(wake.object), state: words(wake.state) })
        : wake.event === 'indicator.turned_red'
          ? m.catalogue_wake_red()
          : m.catalogue_wake_event({ event: wake.event });
  const groups = new Map<string, CatalogueEntry[]>();
  for (const entry of entries) {
    const who = entry.shippedBy ?? m.catalogue_by_kete();
    groups.set(who, [...(groups.get(who) ?? []), entry]);
  }
  return (
    <Panel title={m.catalogue_title()}>
      <div className="grid gap-4">
        {[...groups].map(([who, list]) => (
          <section key={who} className="grid gap-2">
            <h3 className="m-0 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
              {m.catalogue_by({ who })}
            </h3>
            <ul className="m-0 grid list-none gap-3 p-0">
              {list.map((entry) => {
                const t = entry.template;
                return (
                  <li
                    key={`${entry.product}:${t.name}`}
                    className="grid content-start gap-2 rounded-card border border-line bg-surface p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <ActorAvatar
                        kind="agent"
                        id={`${entry.product}:${t.name}`}
                        name={words(t.label)}
                        face={
                          t.avatar
                            ? {
                                glyph: t.avatar.glyph,
                                ...(t.avatar.tint ? { tint: t.avatar.tint as ActorTint } : {}),
                              }
                            : null
                        }
                        size={32}
                      />
                      <div className="grid min-w-0 flex-1">
                        <span className="font-semibold">{words(t.label)}</span>
                        <small className="text-fg-muted">{who}</small>
                      </div>
                      {administrator && (
                        <Tag tone={entry.enabled ? 'validated' : 'neutral'}>
                          {entry.enabled ? m.catalogue_open() : m.catalogue_closed()}
                        </Tag>
                      )}
                    </div>
                    <p className="m-0 text-body-sm text-fg-soft">{words(t.mission)}</p>
                    <dl className="m-0 grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[12.5px]">
                      <dt className="text-fg-muted">{m.catalogue_sources()}</dt>
                      <dd className="m-0 flex flex-wrap gap-1">
                        {t.sources.map((source) => (
                          <span
                            key={source}
                            className="rounded-full border border-line-control px-2 py-px text-[12px]"
                          >
                            {KETE_SOURCES[source]?.() ?? apps[source] ?? source}
                          </span>
                        ))}
                      </dd>
                      <dt className="text-fg-muted">{m.catalogue_wakes()}</dt>
                      <dd className="m-0 text-fg-soft">
                        {entry.wakes.length
                          ? entry.wakes.map(wakeWords).join(' · ')
                          : m.catalogue_wake_asked()}
                      </dd>
                      <dt className="text-fg-muted">{m.catalogue_take_on()}</dt>
                      <dd className="m-0 text-fg-soft">{TAKE_ON[t.take_on ?? 'propose']()}</dd>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      {entry.enabled && (
                        <Button
                          onClick={async () => {
                            setNote(null);
                            const answer = await takeTemplate({
                              data: { product: entry.product, name: t.name },
                            });
                            if (!answer.ok) return setNote(refusal(answer.error));
                            await router.navigate({
                              to: '/mes-agents',
                              search: { agent: answer.agentId },
                            });
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
                                name: t.name,
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
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {note && (
        <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
          {note}
        </p>
      )}
    </Panel>
  );
}
