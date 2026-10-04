import { EmptyState, PageHeader, Row, RowList, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchDatasets, uploadTable } from '@/lib/datasets';
import { DialogForm, refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/donnees')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchDatasets(),
  component: DatasetsPage,
});

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
const ACCEPT =
  '.xlsx,.ods,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,text/csv';
/** The content type the API reads, from the file's own or its extension. */
const typeOf = (file: File) =>
  file.type && file.type !== 'application/octet-stream'
    ? file.type
    : file.name.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : file.name.endsWith('.ods')
        ? 'application/vnd.oasis.opendocument.spreadsheet'
        : file.name.endsWith('.tsv')
          ? 'text/tab-separated-values'
          : 'text/csv';

/** The teams' data she may read (spec 031), and a table she brings. */
function DatasetsPage() {
  const { me } = Route.useRouteContext();
  const { datasets } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AppShell me={me} current="datasets">
      <PageHeader
        title={m.datasets_title()}
        description={m.datasets_explain()}
        actions={
          <DialogForm
            title={m.datasets_upload()}
            trigger="primary"
            busy={busy}
            ready={name.trim() !== '' && file !== null}
            onSubmit={() => {
              if (!file) return;
              setBusy(true);
              setError(null);
              void toBase64(file)
                .then((data) =>
                  uploadTable({
                    data: { name, fileName: file.name, contentType: typeOf(file), data },
                  }),
                )
                .then(async (answer) => {
                  if (!answer.ok) setError(refusal(answer.error));
                  else {
                    setName('');
                    setFile(null);
                  }
                  await router.invalidate();
                })
                .catch(() => setError(m.error_generic()))
                .finally(() => setBusy(false));
            }}
          >
            <TextField
              label={m.datasets_name()}
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="grid gap-1.5 text-body-sm font-semibold">
              {m.datasets_file()}
              <input
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </DialogForm>
        }
      />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      {datasets.length === 0 ? (
        <EmptyState title={m.datasets_none()} />
      ) : (
        <RowList label={m.datasets_title()}>
          {datasets.map((d) => (
            <Row
              key={d.datasetId}
              href={`/donnees/${d.datasetId}`}
              title={d.name}
              meta={[
                m.datasets_rows({ count: d.rowCount }),
                d.audience.includes('everyone') ? m.datasets_everyone() : m.datasets_mine(),
                d.sourceName,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </RowList>
      )}
    </AppShell>
  );
}
