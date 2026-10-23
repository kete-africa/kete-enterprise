import { CanvasIcon, EmptyState, PageSection, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchPlace } from '@/lib/objects';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { toneOf } from './assets';

export const Route = createFileRoute('/lieux/$placeId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchPlace({ data: { placeId: params.placeId } }),
  component: PlacePage,
});

/** One place (spec 100): where things are — its address, its unit and client, what it hosts. */
function PlacePage() {
  const { me } = Route.useRouteContext();
  const card = Route.useLoaderData();
  if (!card) {
    return (
      <AppShell me={me} current="assets">
        <EmptyState title={m.place_not_found()} />
      </AppShell>
    );
  }
  const { place, titles } = card as typeof card & { titles: Record<string, string> };
  return (
    <AppShell me={me} current="assets">
      <section className="overflow-hidden rounded-card border border-line-strong bg-surface">
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="grid size-10 place-items-center rounded-control bg-state-info-surface text-state-info-fg">
            <CanvasIcon name="pin" size={20} />
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="text-title font-semibold [overflow-wrap:anywhere]">{place.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
              <Tag tone="info">{place.subtype ?? m.place_kind()}</Tag>
              {place.address && <span>{place.address}</span>}
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
        <ul className="flex flex-wrap gap-2 px-4 pb-3">
          {(
            [
              [m.axis_unit(), place.unitId ? titles[`unit:${place.unitId}`] : undefined],
              [m.axis_party(), place.partyId ? titles[`party:${place.partyId}`] : undefined],
            ] as [string, string | undefined][]
          ).map(([label, value]) => (
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
      </section>
      <PageSection title={m.place_hosts()}>
        {card.links.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.asset_no_links()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {card.links.map((link) => (
              <li
                key={`${link.relation}-${link.object.kind}-${link.object.id}`}
                className="flex flex-wrap items-center gap-3 py-2.5 text-body-sm"
              >
                <a
                  href={link.object.href ?? '#'}
                  className="min-w-0 flex-1 font-semibold text-link underline"
                >
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
    </AppShell>
  );
}
