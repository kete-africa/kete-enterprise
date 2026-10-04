import { EmptyState, PageHeader, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  fetchMyDocuments,
  fetchTemplates,
  fillTemplate,
  removeMyDocument,
  type DocumentTemplate,
  type GeneratedDocument,
} from '@/lib/documents';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/documents')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [templates, mine] = await Promise.all([fetchTemplates(), fetchMyDocuments()]);
    return { templates: templates.templates, pdf: templates.pdf, documents: mine.documents };
  },
  component: DocumentsPage,
});

/** Her documents (spec 038): the organization's templates, filled for her, and what she produced. */
function DocumentsPage() {
  const { me } = Route.useRouteContext();
  const { templates, pdf, documents } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<GeneratedDocument | null>(null);
  return (
    <AppShell me={me} current="documents">
      <PageHeader title={m.documents_title()} description={m.documents_explain()} />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      {ready && (
        <p role="status" className="flex flex-wrap items-center gap-2">
          {m.documents_ready()}
          <a href={ready.href} className="font-semibold text-link underline">
            {m.documents_download()} · {ready.name}
          </a>
        </p>
      )}
      <section className="grid gap-3">
        <h2 className="font-heading text-title font-semibold">{m.documents_templates()}</h2>
        {templates.length === 0 ? (
          <EmptyState title={m.documents_no_template()} />
        ) : (
          <ul className="grid gap-2">
            {templates.map((t) => (
              <li
                key={t.templateId}
                className="flex flex-wrap items-center gap-3 rounded-box border border-line bg-surface p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t.name}</p>
                  {t.description && <p className="text-body-sm text-fg-muted">{t.description}</p>}
                </div>
                <FillForm
                  template={t}
                  pdf={pdf}
                  onDone={(answer) => {
                    setError(answer.ok ? null : refusal(answer.error));
                    if (answer.ok) setReady(answer.document);
                    void router.invalidate();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-3">
        <h2 className="font-heading text-title font-semibold">{m.documents_mine()}</h2>
        {documents.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.documents_none()}</p>
        ) : (
          <ul className="grid gap-1">
            {documents.map((d) => (
              <li
                key={d.documentId}
                className="flex flex-wrap items-center gap-3 border-t border-line pt-2"
              >
                <a
                  href={d.href}
                  className="min-w-0 flex-1 truncate font-semibold text-link underline"
                >
                  {d.name}
                </a>
                <span className="text-body-sm text-fg-muted">
                  {new Date(d.createdAt).toLocaleString(getLocale())}
                </span>
                <button
                  type="button"
                  className="text-body-sm font-semibold text-link underline"
                  onClick={() =>
                    void removeMyDocument({ data: { documentId: d.documentId } }).then(() =>
                      router.invalidate(),
                    )
                  }
                >
                  {m.documents_remove()}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

type Filled = { ok: true; document: GeneratedDocument } | { ok: false; error: string | null };

/** The template's fields, one text each, and the format she wants. */
function FillForm({
  template,
  pdf,
  onDone,
}: {
  template: DocumentTemplate;
  pdf: boolean;
  onDone: (answer: Filled) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx');
  const [busy, setBusy] = useState(false);
  return (
    <DialogForm
      title={template.name}
      label={m.documents_fill()}
      busy={busy}
      ready
      onSubmit={() => {
        setBusy(true);
        void fillTemplate({ data: { templateId: template.templateId, values, format } })
          .then((answer) =>
            onDone(
              answer.ok
                ? { ok: true, document: (answer.data as { document: GeneratedDocument }).document }
                : { ok: false, error: answer.error },
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      {template.fields.map((field) => (
        <TextField
          key={field}
          label={field}
          value={values[field] ?? ''}
          maxLength={5000}
          onChange={(e) => setValues({ ...values, [field]: e.target.value })}
        />
      ))}
      {pdf && (
        <Select
          label={m.documents_format()}
          value={format}
          onChange={(e) => setFormat(e.target.value === 'pdf' ? 'pdf' : 'docx')}
        >
          <option value="docx">{m.documents_word()}</option>
          <option value="pdf">{m.documents_pdf()}</option>
        </Select>
      )}
    </DialogForm>
  );
}
