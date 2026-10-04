import { EmptyState, PageHeader, Row, RowList } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { searchEverywhere, type SearchResult } from '@/lib/notifications';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/recherche')({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' ? { q: search['q'].slice(0, 200) } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) =>
    deps.q ? searchEverywhere({ data: { q: deps.q } }) : Promise.resolve(null),
  component: SearchPage,
});

const kinds: { kind: SearchResult['kind']; label: () => string }[] = [
  { kind: 'decision', label: m.search_kind_decision },
  { kind: 'action', label: m.search_kind_action },
  { kind: 'conversation', label: m.search_kind_conversation },
  { kind: 'document', label: m.search_kind_document },
  { kind: 'person', label: m.search_kind_person },
  { kind: 'app', label: m.search_kind_app },
];

/** One question across what she may see (spec 030), grouped by kind. */
function SearchPage() {
  const { me } = Route.useRouteContext();
  const found = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const [q, setQ] = useState(search.q ?? '');
  return (
    <AppShell me={me} current="search">
      <PageHeader title={m.search_title()} description={m.search_explain()} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void router.navigate({ to: '/recherche', search: { q } });
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-body-sm font-semibold">
          {m.search_label()}
          <input
            className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal text-fg"
            value={q}
            maxLength={200}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded-control bg-action px-4 py-2 font-semibold text-on-action"
        >
          {m.search_go()}
        </button>
      </form>
      {found &&
        (found.results.length === 0 ? (
          <EmptyState title={m.search_none()} />
        ) : (
          kinds.map(({ kind, label }) => {
            const items = found.results.filter((r) => r.kind === kind);
            return items.length ? (
              <RowList key={kind} label={label()}>
                {items.map((r, i) => (
                  <Row
                    key={`${kind}-${i}`}
                    title={r.title}
                    href={r.href}
                    {...(r.detail ? { meta: r.detail } : {})}
                  />
                ))}
              </RowList>
            ) : null;
          })
        ))}
    </AppShell>
  );
}
