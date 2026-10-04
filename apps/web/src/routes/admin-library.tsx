import { Button, EmptyState, PageHeader, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { DialogForm, refusal, Select } from '@/lib/forms';
import {
  createSource,
  fetchDocuments,
  fetchSources,
  removeDocument,
  removeSource,
  updateSource,
  uploadDocument,
  type LibraryDocument,
  type LibrarySource,
} from '@/lib/knowledge';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchChart } from '@/lib/structure';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/bibliotheque')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [sources, chart] = await Promise.all([fetchSources(), fetchChart({ data: {} })]);
    return {
      sources: sources.sources,
      units: chart.units.filter((u) => !u.endsOn).map((u) => ({ unitId: u.unitId, name: u.name })),
    };
  },
  component: AdminLibraryPage,
});

type Who = 'everyone' | 'admins' | 'units';
type Answer = { ok: boolean; error: string | null; data?: unknown };
type Run = (work: () => Promise<Answer>, done?: (data: unknown) => string) => void;

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * The library's sources (spec 028): an administrator adds them, opens each to everyone, to units
 * (with their teams) or to administrators, adds documents, switches a source off or on.
 */
function AdminLibraryPage() {
  const { me } = Route.useRouteContext();
  const { sources, units } = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState({ name: '', who: 'everyone' as Who, units: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const unitName = new Map(units.map((u) => [u.unitId, u.name]));
  const audienceText = (keys: string[]) =>
    keys
      .map((k) =>
        k === 'everyone'
          ? m.kadmin_everyone()
          : k === 'role:admin'
            ? m.kadmin_admins()
            : k.startsWith('unit:')
              ? (unitName.get(k.slice(5)) ?? k.slice(5))
              : k,
      )
      .join(', ');
  const run: Run = (work, done) => {
    setBusy(true);
    setNotice(null);
    void work()
      .then(async (answer) => {
        setNotice(
          answer.ok
            ? done
              ? { ok: true, text: done(answer.data) }
              : null
            : { ok: false, text: refusal(answer.error) },
        );
        await router.invalidate();
      })
      .catch(() => setNotice({ ok: false, text: m.error_generic() }))
      .finally(() => setBusy(false));
  };
  const audience =
    draft.who === 'everyone'
      ? ['everyone']
      : draft.who === 'admins'
        ? ['role:admin']
        : draft.units.map((u) => `unit:${u}`);
  return (
    <AppShell me={me} current="admin_library">
      <PageHeader
        title={m.kadmin_title()}
        description={m.kadmin_explain()}
        actions={
          <DialogForm
            title={m.kadmin_new()}
            trigger="primary"
            busy={busy}
            ready={draft.name.trim() !== '' && audience.length > 0}
            onSubmit={() =>
              run(async () => {
                const answer = await createSource({ data: { name: draft.name, audience } });
                if (answer.ok) setDraft({ name: '', who: 'everyone', units: [] });
                return answer;
              })
            }
          >
            <TextField
              label={m.kadmin_name()}
              value={draft.name}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Select
              label={m.kadmin_audience()}
              value={draft.who}
              onChange={(e) => setDraft({ ...draft, who: e.target.value as Who })}
            >
              <option value="everyone">{m.kadmin_everyone()}</option>
              <option value="units">{m.kadmin_units()}</option>
              <option value="admins">{m.kadmin_admins()}</option>
            </Select>
            {draft.who === 'units' && (
              <fieldset className="grid max-h-60 gap-1 overflow-auto">
                <legend className="mb-1 text-body-sm font-semibold">{m.kadmin_pick_units()}</legend>
                {units.map((u) => (
                  <label key={u.unitId} className="flex items-center gap-2 text-body-sm">
                    <input
                      type="checkbox"
                      checked={draft.units.includes(u.unitId)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          units: e.target.checked
                            ? [...draft.units, u.unitId]
                            : draft.units.filter((x) => x !== u.unitId),
                        })
                      }
                    />
                    {u.name}
                  </label>
                ))}
              </fieldset>
            )}
          </DialogForm>
        }
      />
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={notice.ok ? 'text-fg-muted' : 'text-state-error-fg'}
        >
          {notice.text}
        </p>
      )}
      {busy && <p className="text-body-sm text-fg-muted">{m.kadmin_adding()}</p>}
      {sources.length === 0 ? (
        <EmptyState title={m.kadmin_none()} />
      ) : (
        <div className="grid gap-4">
          {sources.map((s) => (
            <SourceCard
              key={s.sourceId}
              source={s}
              audience={audienceText(s.audience)}
              busy={busy}
              run={run}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function SourceCard({
  source,
  audience,
  busy,
  run,
}: {
  source: LibrarySource;
  audience: string;
  busy: boolean;
  run: Run;
}) {
  const [documents, setDocuments] = useState<LibraryDocument[] | null>(null);
  const inputId = `file-${source.sourceId}`;
  const load = () =>
    void fetchDocuments({ data: { sourceId: source.sourceId } }).then((r) =>
      setDocuments(r.documents),
    );
  return (
    <section className="grid gap-3 rounded-box border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-title font-semibold">{source.name}</h2>
        <Tag tone={source.enabled ? 'validated' : 'neutral'}>
          {source.enabled ? m.kadmin_on() : m.kadmin_off()}
        </Tag>
        <span className="text-body-sm text-fg-muted">
          {m.kadmin_audience()} : {audience} · {m.library_documents({ count: source.documents })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center rounded-control border border-line-control px-3 py-1.5 text-body-sm font-semibold hover:bg-surface-hover"
        >
          {m.kadmin_add_doc()}
        </label>
        <input
          id={inputId}
          type="file"
          hidden
          accept=".pdf,.docx,.txt,.md,.csv,.json,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            run(
              async () => {
                const answer = await uploadDocument({
                  data: {
                    sourceId: source.sourceId,
                    name: file.name,
                    contentType: file.type || 'text/plain',
                    data: await toBase64(file),
                  },
                });
                if (answer.ok && documents) load();
                return answer;
              },
              (data) => {
                const d = data as { chunks: number; unchanged: boolean } | null;
                return d?.unchanged
                  ? m.kadmin_unchanged({ title: file.name })
                  : m.kadmin_added({ title: file.name, chunks: d?.chunks ?? 0 });
              },
            );
          }}
        />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => (documents ? setDocuments(null) : load())}
        >
          {m.kadmin_documents()}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(() =>
              updateSource({ data: { sourceId: source.sourceId, enabled: !source.enabled } }),
            )
          }
        >
          {source.enabled ? m.kadmin_switch_off() : m.kadmin_switch_on()}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => removeSource({ data: { sourceId: source.sourceId } }))}
        >
          {m.kadmin_remove_source()}
        </Button>
      </div>
      {documents && (
        <ul className="grid gap-1">
          {documents.length === 0 && (
            <li className="text-body-sm text-fg-muted">{m.kadmin_no_doc()}</li>
          )}
          {documents.map((d) => (
            <li
              key={d.documentId}
              className="flex flex-wrap items-center gap-2 border-t border-line pt-1"
            >
              <span className="font-semibold">{d.title}</span>
              <span className="text-body-sm text-fg-muted">
                {d.pages ? m.kadmin_pages({ pages: d.pages }) + ' · ' : ''}
                {m.kadmin_passages({ chunks: d.chunks })}
              </span>
              <button
                type="button"
                className="ml-auto text-body-sm font-semibold text-link underline"
                onClick={() =>
                  run(async () => {
                    const answer = await removeDocument({ data: { documentId: d.documentId } });
                    if (answer.ok) load();
                    return answer;
                  })
                }
              >
                {m.kadmin_remove_doc()}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
