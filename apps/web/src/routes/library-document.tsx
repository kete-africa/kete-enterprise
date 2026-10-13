import { EmptyState, PageHeader } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { fetchDocumentReading } from '@/lib/knowledge';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000
    ? value
    : typeof value === 'string' && /^\d{1,6}$/.test(value)
      ? Number(value)
      : undefined;

export const Route = createFileRoute('/bibliotheque/document/$documentId')({
  validateSearch: (search: Record<string, unknown>): { page?: number; passage?: number } => {
    const page = whole(search['page']);
    const passage = whole(search['passage']);
    return {
      ...(page !== undefined ? { page } : {}),
      ...(passage !== undefined ? { passage } : {}),
    };
  },
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchDocumentReading({ data: { documentId: params.documentId } }),
  component: DocumentPage,
});

/**
 * A document of the library as she reads it (spec 064): its pages, each passage as it was indexed;
 * the passage an answer cited is marked and shown first, at its page.
 */
function DocumentPage() {
  const { me } = Route.useRouteContext();
  const reading = Route.useLoaderData();
  const { page, passage } = Route.useSearch();
  useEffect(() => {
    const target =
      (passage === undefined ? null : document.getElementById(`passage-${passage}`)) ??
      (page === undefined ? null : document.getElementById(`page-${page}`));
    target?.scrollIntoView({ block: 'center' });
  }, [page, passage]);
  if (!reading) {
    return (
      <AppShell me={me} current="library">
        <EmptyState title={m.document_not_found()} />
      </AppShell>
    );
  }
  return (
    <AppShell me={me} current="library">
      <PageHeader
        breadcrumbs={[{ label: m.library_title(), href: '/bibliotheque' }]}
        title={reading.title}
        description={m.document_source({ source: reading.sourceName })}
        actions={
          reading.uri ? (
            <a href={reading.uri} className="font-semibold text-link underline" rel="noreferrer">
              {m.document_original()}
            </a>
          ) : undefined
        }
      />
      {reading.pages.length > 1 && (
        <nav aria-label={m.document_pages()} className="flex flex-wrap gap-1.5">
          {reading.pages.map((one, index) =>
            one.page === null ? null : (
              <a
                key={`${one.page}-${index}`}
                href={`#page-${one.page}`}
                aria-current={one.page === page ? 'page' : undefined}
                className="rounded-control border border-line-control px-2 py-1 text-body-sm font-semibold hover:bg-surface-hover aria-[current=page]:bg-surface-selected"
              >
                {m.document_page({ page: String(one.page) })}
              </a>
            ),
          )}
        </nav>
      )}
      <article className="grid gap-6">
        {reading.pages.map((one, index) => (
          <section
            key={`${one.page ?? 'all'}-${index}`}
            id={one.page === null ? undefined : `page-${one.page}`}
            aria-label={
              one.page === null ? reading.title : m.document_page({ page: String(one.page) })
            }
            className="grid gap-3 rounded-box border border-line bg-surface p-5"
          >
            {one.page !== null && (
              <p className="text-body-sm font-semibold text-fg-muted">
                {m.document_page({ page: String(one.page) })}
              </p>
            )}
            {one.passages.map((item) => (
              <p
                key={item.passage}
                id={`passage-${item.passage}`}
                className={
                  item.passage === passage
                    ? 'whitespace-pre-wrap rounded-control border-s-4 border-state-verify bg-state-verify-surface px-3 py-2 text-fg'
                    : 'whitespace-pre-wrap text-fg'
                }
              >
                {item.passage === passage && (
                  <span className="mb-1 block text-body-sm font-semibold text-state-verify-fg">
                    {m.document_cited()}
                  </span>
                )}
                {item.text}
              </p>
            ))}
          </section>
        ))}
        {reading.truncated && (
          <p className="text-body-sm text-fg-muted">{m.document_truncated()}</p>
        )}
      </article>
    </AppShell>
  );
}
