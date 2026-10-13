import { Button, EmptyState, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal, Select } from '@/lib/forms';
import {
  createParty,
  fetchParties,
  partyRoles,
  settleDuplicate,
  type Duplicate,
  type PartyRole,
} from '@/lib/parties';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tiers')({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' ? { q: search['q'].slice(0, 120) } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) => fetchParties({ data: { q: deps.q ?? '' } }),
  component: PartiesPage,
});

export const roleWords: Record<PartyRole, () => string> = {
  client: m.party_role_client,
  supplier: m.party_role_supplier,
  funder: m.party_role_funder,
  partner: m.party_role_partner,
};
const becauseWords: Record<Duplicate['because'][number], () => string> = {
  name: m.party_same_name,
  phone: m.party_same_phone,
  email: m.party_same_email,
};

/**
 * Third parties (spec 073, doctrine D-047): who the organization works with. One record each;
 * duplicates are proposed to who may merge them.
 */
function PartiesPage() {
  const { me } = Route.useRouteContext();
  const { parties, manages, duplicates } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const [q, setQ] = useState(search.q ?? '');
  const [draft, setDraft] = useState({
    name: '',
    role: 'client' as PartyRole,
    phone: '',
    email: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function settle(duplicate: Duplicate, same: boolean) {
    setPending(true);
    setError(null);
    const answer = await settleDuplicate({
      data: { keep: duplicate.a.partyId, merge: duplicate.b.partyId, same },
    });
    setPending(false);
    if (!answer.ok) return setError(refusal(answer.error));
    await router.invalidate();
  }

  return (
    <AppShell me={me} current="parties">
      <PageHeader title={m.nav_parties()} description={m.parties_explain()} />
      {duplicates.length > 0 && (
        <PageSection first title={m.parties_duplicates()}>
          <ul className="divide-y divide-line">
            {duplicates.map((duplicate) => (
              <li
                key={`${duplicate.a.partyId}:${duplicate.b.partyId}`}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1 basis-72">
                  <p>
                    <a
                      href={`/tiers/${duplicate.a.partyId}`}
                      className="font-semibold text-link underline"
                    >
                      {duplicate.a.name}
                    </a>
                    {' · '}
                    <a
                      href={`/tiers/${duplicate.b.partyId}`}
                      className="font-semibold text-link underline"
                    >
                      {duplicate.b.name}
                    </a>
                  </p>
                  <p className="text-body-sm text-fg-muted">
                    {duplicate.because.map((reason) => becauseWords[reason]()).join(' · ')}
                  </p>
                </div>
                <Button disabled={pending} onClick={() => void settle(duplicate, true)}>
                  {m.parties_merge({ name: duplicate.a.name })}
                </Button>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void settle(duplicate, false)}
                >
                  {m.parties_distinct()}
                </Button>
              </li>
            ))}
          </ul>
        </PageSection>
      )}
      <PageSection first={duplicates.length === 0} title={m.parties_list()}>
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void router.navigate({ to: '/tiers', search: q.trim() ? { q: q.trim() } : {} });
          }}
        >
          <div className="min-w-0 flex-1 basis-64">
            <TextField
              label={m.parties_search()}
              value={q}
              maxLength={120}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            {m.parties_search_button()}
          </Button>
        </form>
        {parties.length === 0 ? (
          <EmptyState title={search.q ? m.parties_none_found() : m.parties_none()} />
        ) : (
          <ul className="divide-y divide-line">
            {parties.map((party) => (
              <li key={party.partyId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <a href={`/tiers/${party.partyId}`} className="font-semibold text-link underline">
                    {party.name}
                  </a>
                  <p className="text-body-sm text-fg-muted">
                    {[party.phone, party.email].filter(Boolean).join(' · ') ||
                      m.parties_no_contact()}
                  </p>
                </div>
                <span className="flex flex-wrap gap-2">
                  {party.roles.map((role) => (
                    <Tag key={role} tone="info">
                      {roleWords[role]()}
                    </Tag>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      {manages && (
        <PageSection title={m.parties_new()}>
          <form
            className="grid gap-3 md:max-w-xl"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              const answer = await createParty({
                data: {
                  name: draft.name,
                  roles: [draft.role],
                  phone: draft.phone,
                  email: draft.email,
                },
              });
              setPending(false);
              if (!answer.ok) return setError(refusal(answer.error));
              setDraft({ name: '', role: 'client', phone: '', email: '' });
              await router.navigate({ to: `/tiers/${answer.partyId}` });
            }}
          >
            <TextField
              label={m.field_name()}
              value={draft.name}
              maxLength={200}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
            />
            <Select
              label={m.parties_role()}
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as PartyRole })}
            >
              {partyRoles.map((role) => (
                <option key={role} value={role}>
                  {roleWords[role]()}
                </option>
              ))}
            </Select>
            <TextField
              label={m.parties_phone()}
              value={draft.phone}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
            <TextField
              type="email"
              label={m.parties_email()}
              value={draft.email}
              maxLength={320}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <div>
              <Button type="submit" disabled={pending || !draft.name.trim()}>
                {m.parties_create()}
              </Button>
            </div>
          </form>
        </PageSection>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </AppShell>
  );
}
