import { CanvasIcon, EmptyState, PageSection, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { ObjectHistory, useObjectLive } from '@/lib/object-history';
import {
  assetStates,
  fetchAsset,
  fetchObjectEvents,
  setAssetState,
  type AssetState,
} from '@/lib/objects';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { toneOf } from './assets';

export const Route = createFileRoute('/equipements/$assetId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => {
    const [card, events] = await Promise.all([
      fetchAsset({ data: { assetId: params.assetId } }),
      fetchObjectEvents({ data: { kind: 'asset', id: params.assetId } }),
    ]);
    return card ? { ...card, events } : null;
  },
  component: AssetPage,
});

const stateWords: Record<AssetState, () => string> = {
  in_service: m.asset_state_in_service,
  alert: m.asset_state_alert,
  maintenance: m.asset_state_maintenance,
  out_of_service: m.asset_state_out_of_service,
  retired: m.asset_state_retired,
};

/**
 * One asset (spec 100; canvas v7, « Un objet »): its card — kind, state, who answers for it, its
 * four axes, its own figures —, its named links both ways, what is in progress about it, its history
 * (spec 101), its thread. Every name is one she may read; what she may not read is not named. The
 * page reads itself again when the asset changes.
 */
function AssetPage() {
  const { me } = Route.useRouteContext();
  const card = Route.useLoaderData();
  const router = useRouter();
  const { assetId } = Route.useParams();
  useObjectLive('asset', assetId);
  const [error, setError] = useState<string | null>(null);
  if (!card) {
    return (
      <AppShell me={me} current="assets">
        <EmptyState title={m.asset_not_found()} />
      </AppShell>
    );
  }
  const { asset, titles, holder } = card as typeof card & {
    titles: Record<string, string>;
    holder: string | null;
  };
  const axes: [string, string | undefined][] = [
    [m.axis_party(), asset.partyId ? titles[`party:${asset.partyId}`] : undefined],
    [m.axis_project(), asset.projectId ? titles[`project:${asset.projectId}`] : undefined],
    [m.axis_unit(), asset.unitId ? titles[`unit:${asset.unitId}`] : undefined],
    [m.axis_person(), holder ?? undefined],
  ];
  const figures: [string, string][] = [
    ...asset.facts.map((f): [string, string] => [f.label, f.value]),
    ...(asset.commissionedOn
      ? [[m.asset_commissioned(), asset.commissionedOn] as [string, string]]
      : []),
    ...(asset.warrantyUntil ? [[m.asset_warranty(), asset.warrantyUntil] as [string, string]] : []),
    ...(asset.serial ? [[m.asset_serial(), asset.serial] as [string, string]] : []),
  ];

  return (
    <AppShell me={me} current="assets">
      <section
        aria-label={m.asset_card()}
        className="overflow-hidden rounded-card border border-line-strong bg-surface"
      >
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="grid size-10 place-items-center rounded-control bg-state-info-surface text-state-info-fg">
            <CanvasIcon name="sun" size={20} />
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="text-title font-semibold [overflow-wrap:anywhere]">{asset.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
              <Tag tone="info">
                {asset.subtype ? m.asset_kind_of({ subtype: asset.subtype }) : m.asset_kind()}
              </Tag>
              <Tag tone={toneOf(card.object)}>{stateWords[asset.state]()}</Tag>
              {holder && <span>{m.asset_held_by({ name: holder })}</span>}
            </div>
          </div>
          {card.threadId && (
            <a
              href={`/fils?fil=${card.threadId}`}
              className="inline-flex h-(--control-height) items-center gap-1.5 rounded-control border border-line-control px-2.5 text-body-sm font-semibold text-fg no-underline hover:bg-surface-hover"
            >
              <CanvasIcon name="chat" size={14} />
              {m.asset_its_thread()}
            </a>
          )}
        </div>
        <ul aria-label={m.asset_axes()} className="flex flex-wrap gap-2 px-4 pb-3">
          {axes.map(([label, value]) => (
            <li
              key={label}
              className="inline-flex h-7 items-center gap-2 rounded-full border border-line-control px-3 text-body-sm"
            >
              <span className="text-caption font-semibold uppercase tracking-wide text-fg-muted">
                {label}
              </span>
              {value ?? '—'}
            </li>
          ))}
        </ul>
        {figures.length > 0 && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border-t border-line">
            {figures.map(([label, value]) => (
              <div key={label} className="border-e border-line px-4 py-2.5 last:border-e-0">
                <dt className="text-caption text-fg-muted">{label}</dt>
                <dd className="m-0 font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {card.changeable && (
        <PageSection title={m.asset_change_state()}>
          <div role="group" aria-label={m.asset_change_state()} className="flex flex-wrap gap-2">
            {assetStates.map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={asset.state === state}
                className="h-(--control-height) rounded-control border border-line-control px-2.5 text-body-sm font-semibold aria-pressed:bg-selected"
                onClick={async () => {
                  setError(null);
                  const answer = await setAssetState({ data: { assetId: asset.assetId, state } });
                  if (!answer.ok) return setError(refusal(answer.error));
                  await router.invalidate();
                }}
              >
                {stateWords[state]()}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </PageSection>
      )}

      <PageSection title={m.asset_links()}>
        {card.links.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.asset_no_links()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {card.links.map((link) => (
              <li
                key={`${link.direction}-${link.relation}-${link.object.kind}-${link.object.id}`}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-body-sm max-sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span className="text-caption font-semibold uppercase tracking-wide text-fg-muted max-sm:col-span-2">
                  {link.label}
                </span>
                <a href={link.object.href ?? '#'} className="font-semibold text-link underline">
                  {link.object.title}
                </a>
                {link.object.stateLabel && (
                  <Tag tone={toneOf(link.object)}>{link.object.stateLabel}</Tag>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title={m.asset_in_progress()}>
        {card.holdings.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.asset_nothing_in_progress()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {card.holdings.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5 text-body-sm">
                <span className="min-w-0 flex-1">{h.what}</span>
                {h.due && <span className="tabular-nums text-fg-muted">{h.due}</span>}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <ObjectHistory
        events={card.events}
        stateWord={(state) =>
          state && state in stateWords ? stateWords[state as AssetState]() : (state ?? '')
        }
      />
    </AppShell>
  );
}
