import { Button, PageHeader, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchMentionables } from '@/lib/chat/api';
import { dossierGesture, fetchDossier, searchDossier } from '@/lib/dossiers';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/dossiers/$dossierId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => {
    const [dossier, mentionables] = await Promise.all([
      fetchDossier({ data: { dossierId: params.dossierId } }),
      fetchMentionables(),
    ]);
    return { ...dossier, people: mentionables.people };
  },
  component: DossierPage,
});

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** One dossier (spec 034): its documents and their search, what it gathers, its members. */
function DossierPage() {
  const { me } = Route.useRouteContext();
  const { dossier, members, links, documents, people } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ label: string; text: string }[] | null>(null);
  const [link, setLink] = useState({ title: '', href: '' });
  const [member, setMember] = useState('');
  const owner = dossier.role === 'owner';
  const gesture = (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    void dossierGesture({ data: { dossierId: dossier.dossierId, path, body } })
      .then(async (answer) => {
        if (!answer.ok) setError(refusal(answer.error));
        await router.invalidate();
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };
  return (
    <AppShell me={me} current="dossiers">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.dossiers_title(), href: '/dossiers' }]}
        title={dossier.name}
        {...(dossier.description ? { description: dossier.description } : {})}
        actions={
          <>
            <a
              href="/assistant"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
            >
              {m.dossier_ask()}
            </a>
            {owner && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => gesture('', { archived: !dossier.archived })}
              >
                {dossier.archived ? m.dossier_unarchive() : m.dossier_archive()}
              </Button>
            )}
          </>
        }
      />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}

      <section className="grid gap-3 rounded-box border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-title font-semibold">{m.dossier_documents()}</h2>
          <label
            htmlFor="dossier-file"
            className="ml-auto inline-flex cursor-pointer items-center rounded-control border border-line-control px-3 py-1.5 text-body-sm font-semibold hover:bg-surface-hover"
          >
            {m.dossier_add_doc()}
          </label>
          <input
            id="dossier-file"
            type="file"
            hidden
            accept=".pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.rtf,.txt,.md,.csv,.json,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void toBase64(file).then((data) =>
                  gesture('/documents', {
                    name: file.name,
                    contentType: file.type || 'text/plain',
                    data,
                  }),
                );
            }}
          />
        </div>
        {documents.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.dossier_no_doc()}</p>
        ) : (
          <ul className="grid gap-1">
            {documents.map((d) => (
              <li key={d.documentId} className="flex items-center gap-2 border-t border-line pt-1">
                <span className="font-semibold">{d.title}</span>
                <button
                  type="button"
                  className="ml-auto text-body-sm font-semibold text-link underline"
                  onClick={() => gesture(`/documents/${d.documentId}/remove`)}
                >
                  {m.dossier_remove()}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length < 2) return;
            void searchDossier({ data: { dossierId: dossier.dossierId, q } }).then((r) =>
              setHits(r.hits),
            );
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-body-sm font-semibold">
            {m.dossier_search()}
            <input
              className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal text-fg"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <Button type="submit">{m.library_go()}</Button>
        </form>
        {hits &&
          (hits.length === 0 ? (
            <p className="text-fg-muted">{m.library_none()}</p>
          ) : (
            hits.map((h, i) => (
              <article key={i} className="grid gap-1 border-t border-line pt-2">
                <b>{h.label}</b>
                <p className="whitespace-pre-line text-body-sm">{h.text}</p>
              </article>
            ))
          ))}
      </section>

      <section className="grid gap-3 rounded-box border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-title font-semibold">{m.dossier_links()}</h2>
          <span className="ml-auto">
            <DialogForm
              title={m.dossier_add_link()}
              busy={busy}
              ready={link.title.trim() !== '' && /^https:\/\//.test(link.href)}
              onSubmit={() => {
                gesture('/links', {
                  kind: 'url',
                  ref: link.href.slice(0, 300),
                  title: link.title,
                  href: link.href,
                });
                setLink({ title: '', href: '' });
              }}
            >
              <TextField
                label={m.dossier_link_title()}
                value={link.title}
                maxLength={300}
                onChange={(e) => setLink({ ...link, title: e.target.value })}
              />
              <TextField
                label={m.dossier_link_href()}
                value={link.href}
                maxLength={1000}
                onChange={(e) => setLink({ ...link, href: e.target.value })}
              />
            </DialogForm>
          </span>
        </div>
        {links.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.dossier_no_link()}</p>
        ) : (
          <ul className="grid gap-1">
            {links.map((l) => (
              <li key={l.linkId} className="flex items-center gap-2 border-t border-line pt-1">
                <a
                  href={l.kind === 'conversation' ? `/dossiers/${dossier.dossierId}` : l.href}
                  className="font-semibold text-link underline"
                >
                  {l.title}
                </a>
                <Tag>{l.kind}</Tag>
                <button
                  type="button"
                  className="ml-auto text-body-sm font-semibold text-link underline"
                  onClick={() => gesture(`/links/${l.linkId}/remove`)}
                >
                  {m.dossier_remove()}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 rounded-box border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-title font-semibold">{m.dossier_members()}</h2>
          {owner && (
            <span className="ml-auto">
              <DialogForm
                title={m.dossier_add_member()}
                busy={busy}
                ready={member !== ''}
                onSubmit={() => {
                  const p = people.find((x) => x.userId === member);
                  if (p) gesture('/members', { userId: p.userId, name: p.name });
                  setMember('');
                }}
              >
                <Select
                  label={m.dossier_member()}
                  value={member}
                  onChange={(e) => setMember(e.target.value)}
                >
                  <option value="" />
                  {people
                    .filter((p) => !members.some((x) => x.userId === p.userId))
                    .map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </DialogForm>
            </span>
          )}
        </div>
        <ul className="grid gap-1">
          {members.map((x) => (
            <li key={x.userId} className="flex items-center gap-2 border-t border-line pt-1">
              <span className="font-semibold">{x.name}</span>
              {x.role === 'owner' && <Tag>{m.dossier_owner()}</Tag>}
              {x.role !== 'owner' && (owner || x.userId === me.userId) && (
                <button
                  type="button"
                  className="ml-auto text-body-sm font-semibold text-link underline"
                  onClick={() => gesture(`/members/${x.userId}/remove`)}
                >
                  {m.dossier_remove()}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
