import { EmptyState, PageHeader, Row, RowList } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchSources, searchLibrary } from '@/lib/knowledge';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/bibliotheque')({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' ? { q: search['q'].slice(0, 500) } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const [sources, found] = await Promise.all([
      fetchSources(),
      deps.q ? searchLibrary({ data: { q: deps.q } }) : Promise.resolve(null),
    ]);
    return { sources: sources.sources, found };
  },
  component: LibraryPage,
});

/**
 * The company's library (spec 028): a question, the passages that answer it with their document
 * and page, in what she may read; the sources open to her.
 */
function LibraryPage() {
  const { me } = Route.useRouteContext();
  const { sources, found } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const [q, setQ] = useState(search.q ?? '');
  return (
    <AppShell me={me} current="library">
      <PageHeader title={m.library_title()} description={m.library_explain()} />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void router.navigate({ to: '/bibliotheque', search: { q } });
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-body-sm font-semibold">
          {m.library_search()}
          <input
            className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal text-fg"
            value={q}
            maxLength={500}
            placeholder={m.library_search_hint()}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="self-end rounded-control bg-action px-4 py-2 font-semibold text-on-action"
        >
          {m.library_go()}
        </button>
      </form>
      {found?.error && (
        <p role="alert" className="text-state-error-fg">
          {refusal(found.error)}
        </p>
      )}
      {found && !found.error && (
        <section className="grid gap-3" aria-live="polite">
          {found.hits.length === 0 ? (
            <p className="text-fg-muted">{m.library_none()}</p>
          ) : (
            found.hits.map((h) => (
              <article
                key={`${h.documentId}-${h.page ?? 0}-${h.score}`}
                className="grid gap-1 rounded-box border border-line bg-surface p-4"
              >
                <a href={h.href} className="font-semibold text-link underline">
                  {h.label}
                </a>
                <p className="text-body-sm text-fg-muted">
                  {m.library_from({ source: h.sourceName })}
                </p>
                <p className="whitespace-pre-line">{h.text}</p>
              </article>
            ))
          )}
          {search.q && (
            <a href={`/assistant`} className="justify-self-start font-semibold text-link underline">
              {m.library_ask()}
            </a>
          )}
        </section>
      )}
      <section className="grid gap-2">
        <h2 className="font-heading text-title font-semibold">{m.library_sources()}</h2>
        {sources.length === 0 ? (
          <EmptyState title={m.library_no_source()} />
        ) : (
          <RowList label={m.library_sources()}>
            {sources.map((s) => (
              <Row
                key={s.sourceId}
                title={s.name}
                meta={m.library_documents({ count: s.documents })}
              />
            ))}
          </RowList>
        )}
      </section>
    </AppShell>
  );
}
