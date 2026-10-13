import { EmptyState, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchParty, type PartyFact } from '@/lib/parties';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { roleWords } from './parties';

export const Route = createFileRoute('/tiers/$partyId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchParty({ data: { partyId: params.partyId } }),
  component: PartyPage,
});

const channelWords = {
  whatsapp: m.party_channel_whatsapp,
  telegram: m.party_channel_telegram,
  email: m.party_channel_email,
  phone: m.party_channel_phone,
};

/**
 * One third party (spec 073): what it is to the organization, how to reach it, and what each app
 * knows of it — gathered here, held by none of them.
 */
function PartyPage() {
  const { me } = Route.useRouteContext();
  const found = Route.useLoaderData();
  if (!found) {
    return (
      <AppShell me={me} current="parties">
        <EmptyState title={m.party_not_found()} />
      </AppShell>
    );
  }
  const { party, facts } = found;
  const bySource = new Map<string, PartyFact[]>();
  for (const fact of facts) bySource.set(fact.source, [...(bySource.get(fact.source) ?? []), fact]);
  const contact = [
    party.phone,
    party.email,
    party.address,
    party.registration,
    party.channel ? m.party_prefers({ channel: channelWords[party.channel]() }) : null,
  ].filter(Boolean);

  return (
    <AppShell me={me} current="parties">
      <PageHeader
        breadcrumbs={[{ label: m.nav_parties(), href: '/tiers' }]}
        title={party.name}
        description={contact.join(' · ') || m.parties_no_contact()}
        status={
          <span className="flex flex-wrap gap-2">
            {party.roles.map((role) => (
              <Tag key={role} tone="info">
                {roleWords[role]()}
              </Tag>
            ))}
          </span>
        }
      />
      <PageSection first title={m.party_in_apps()}>
        {facts.length === 0 ? (
          <p className="text-fg-muted">{m.party_no_fact()}</p>
        ) : (
          <div className="grid gap-4">
            {[...bySource.entries()].map(([source, known]) => (
              <div key={source}>
                <h3 className="text-body-sm font-semibold">{source}</h3>
                <ul className="divide-y divide-line">
                  {known.map((fact) => (
                    <li key={fact.key} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 basis-64">
                        {fact.href ? (
                          <a href={fact.href} className="text-link underline">
                            {fact.label}
                          </a>
                        ) : (
                          fact.label
                        )}
                      </span>
                      {fact.state && <Tag>{fact.state}</Tag>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </PageSection>
      {party.mergedFrom.length > 0 && (
        <p className="text-body-sm text-fg-muted">
          {m.party_merged_from({ count: String(party.mergedFrom.length) })}
        </p>
      )}
    </AppShell>
  );
}
