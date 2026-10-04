import { EmptyState, PageHeader, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { changeTemplate, fetchTemplates, uploadTemplate } from '@/lib/documents';
import { DialogForm, refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/modeles')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchTemplates(),
  component: AdminTemplatesPage,
});

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** The organization's document templates (spec 038): added, switched off or on, removed. */
function AdminTemplatesPage() {
  const { me } = Route.useRouteContext();
  const { templates, pdf } = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState<{ name: string; description: string; file: File | null }>({
    name: '',
    description: '',
    file: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<{ ok: boolean; error: string | null }>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) setError(refusal(answer.error));
        await router.invalidate();
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };
  return (
    <AppShell me={me} current="admin_templates">
      <PageHeader
        title={m.admin_templates_title()}
        description={m.admin_templates_explain()}
        actions={
          <DialogForm
            title={m.admin_templates_add()}
            trigger="primary"
            busy={busy}
            ready={draft.name.trim() !== '' && draft.file !== null}
            onSubmit={() => {
              const file = draft.file;
              if (!file) return;
              run(async () => {
                const answer = await uploadTemplate({
                  data: {
                    name: draft.name,
                    description: draft.description,
                    data: await toBase64(file),
                  },
                });
                if (answer.ok) setDraft({ name: '', description: '', file: null });
                return answer;
              });
            }}
          >
            <TextField
              label={m.admin_templates_name()}
              value={draft.name}
              maxLength={160}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField
              label={m.admin_templates_description()}
              value={draft.description}
              maxLength={1000}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <label className="grid gap-1.5 text-body-sm font-semibold">
              {m.admin_templates_file()}
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })}
              />
            </label>
          </DialogForm>
        }
      />
      {!pdf && <p className="text-body-sm text-fg-muted">{m.admin_templates_pdf_off()}</p>}
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
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
                <p className="flex items-center gap-2 font-semibold">
                  {t.name}
                  {!t.enabled && <Tag>{m.admin_templates_off()}</Tag>}
                </p>
                <p className="text-body-sm text-fg-muted">
                  {t.fields.length
                    ? m.admin_templates_fields({ fields: t.fields.join(', ') })
                    : m.admin_templates_no_field()}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                className="text-body-sm font-semibold text-link underline"
                onClick={() =>
                  run(() =>
                    changeTemplate({ data: { templateId: t.templateId, enabled: !t.enabled } }),
                  )
                }
              >
                {t.enabled ? m.admin_templates_switch_off() : m.admin_templates_switch_on()}
              </button>
              <button
                type="button"
                disabled={busy}
                className="text-body-sm font-semibold text-link underline"
                onClick={() =>
                  run(() => changeTemplate({ data: { templateId: t.templateId, remove: true } }))
                }
              >
                {m.documents_remove()}
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
