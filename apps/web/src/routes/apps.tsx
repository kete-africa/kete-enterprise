import { EmptyState, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchApps, type AppEntry } from '@/lib/apps';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/apps')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchApps(),
  component: AppsPage,
});

const packName: Record<string, () => string> = {
  surveys: m.nav_surveys,
  performance: m.nav_performance,
  meetings: m.nav_meetings,
  compliance: m.nav_compliance,
};

/** What the center receives from it, in a few words. */
function received(entry: AppEntry): string {
  const parts = [
    entry.receives.reads ? m.apps_reads({ what: entry.receives.reads }) : null,
    entry.receives.waiting > 0 ? m.apps_waiting({ count: String(entry.receives.waiting) }) : null,
    entry.receives.tools > 0 ? m.apps_tools({ count: String(entry.receives.tools) }) : null,
    entry.receives.watch ? m.apps_watch() : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : m.apps_nothing_yet();
}

function Entries({ entries, empty }: { entries: AppEntry[]; empty: string }) {
  if (entries.length === 0) return <p className="text-body-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {entries.map((entry) => {
        const name = entry.name ?? packName[entry.key]?.() ?? entry.key;
        return (
          <li key={`${entry.kind}:${entry.key}`} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1 basis-64">
              {entry.href ? (
                <a
                  href={entry.href}
                  className="font-semibold text-link underline"
                  {...(entry.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                >
                  {name}
                </a>
              ) : (
                <span className="font-semibold">{name}</span>
              )}
              <p className="text-body-sm text-fg-muted">{received(entry)}</p>
            </div>
            {entry.receives.waiting > 0 && (
              <a href="/a-faire" className="text-body-sm font-semibold text-link underline">
                {m.apps_see_waiting()}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * « Apps » (spec 070, doctrine D-042): what stands behind the center — the organization's own
 * tools read by a connector, the team's apps, the business tools delivered with the center — and
 * what the center receives from each.
 */
function AppsPage() {
  const { me } = Route.useRouteContext();
  const { apps } = Route.useLoaderData();
  const of = (kind: AppEntry['kind']) => apps.filter((entry) => entry.kind === kind);
  return (
    <AppShell me={me} current="apps">
      <PageHeader
        title={m.nav_apps()}
        description={m.apps_explain()}
        status={<Tag>{m.apps_count({ count: String(apps.length) })}</Tag>}
      />
      {apps.length === 0 && <EmptyState title={m.apps_none()} />}
      <PageSection first title={m.apps_team()}>
        <Entries entries={of('app')} empty={m.apps_team_none()} />
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
          <a href="/ressources" className="font-semibold text-link underline">
            {m.apps_catalogue()}
          </a>
          <a href="/ressources/demandes/nouvelle" className="font-semibold text-link underline">
            {m.apps_ask()}
          </a>
        </p>
      </PageSection>
      <PageSection title={m.apps_connectors()}>
        <Entries entries={of('connector')} empty={m.apps_connectors_none()} />
        {me.administrator && (
          <p className="mt-3 text-body-sm">
            <a href="/administration/connecteurs" className="font-semibold text-link underline">
              {m.apps_manage_connectors()}
            </a>
          </p>
        )}
      </PageSection>
      <PageSection title={m.apps_packs()}>
        <Entries entries={of('pack')} empty={m.apps_packs_none()} />
      </PageSection>
    </AppShell>
  );
}
