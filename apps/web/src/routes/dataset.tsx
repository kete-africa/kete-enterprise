import { Button, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { datasetGesture, fetchDataset, uploadTable } from '@/lib/datasets';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/donnees/$datasetId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchDataset({ data: { datasetId: params.datasetId } }),
  component: DatasetPage,
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

/** One data set (spec 031): its columns and their types, its first rows, its sharing. */
function DatasetPage() {
  const { me } = Route.useRouteContext();
  const { dataset, manage, preview } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeLabel = (type: 'number' | 'date' | 'text') =>
    type === 'number'
      ? m.datasets_type_number()
      : type === 'date'
        ? m.datasets_type_date()
        : m.datasets_type_text();
  const run = (work: () => Promise<{ ok: boolean; error: string | null }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        after?.();
        await router.invalidate();
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };
  const shared = dataset.audience.includes('everyone');
  return (
    <AppShell me={me} current="datasets">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.datasets_title(), href: '/donnees' }]}
        title={dataset.name}
        description={[m.datasets_rows({ count: dataset.rowCount }), dataset.sourceName]
          .filter(Boolean)
          .join(' · ')}
        actions={
          manage ? (
            <>
              <label
                htmlFor="dataset-file"
                className="inline-flex h-(--control-height) cursor-pointer items-center rounded-control border border-line-control px-(--control-padding) font-semibold hover:bg-surface-hover"
              >
                {m.datasets_replace()}
              </label>
              <input
                id="dataset-file"
                type="file"
                hidden
                accept={ACCEPT}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file)
                    run(async () =>
                      uploadTable({
                        data: {
                          datasetId: dataset.datasetId,
                          fileName: file.name,
                          contentType: typeOf(file),
                          data: await toBase64(file),
                        },
                      }),
                    );
                }}
              />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    datasetGesture({
                      data: {
                        datasetId: dataset.datasetId,
                        audience: shared ? `user:${dataset.ownerId}` : 'everyone',
                      },
                    }),
                  )
                }
              >
                {shared ? m.datasets_keep_owner() : m.datasets_open_everyone()}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => datasetGesture({ data: { datasetId: dataset.datasetId, remove: true } }),
                    () => void router.navigate({ to: '/donnees' }),
                  )
                }
              >
                {m.datasets_remove()}
              </Button>
            </>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      <PageSection first title={m.datasets_columns()}>
        <div className="flex flex-wrap gap-2">
          {dataset.columns.map((c) => (
            <Tag key={c.name}>
              {c.name} · {typeLabel(c.type)}
            </Tag>
          ))}
        </div>
      </PageSection>
      <PageSection title={m.datasets_preview()}>
        <div className="overflow-x-auto rounded-box border border-line">
          <table className="w-full text-body-sm">
            <thead className="bg-surface-muted text-left">
              <tr>
                {dataset.columns.map((c) => (
                  <th key={c.name} className="px-3 py-2 font-semibold">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {dataset.columns.map((c) => (
                    <td
                      key={c.name}
                      className={
                        c.type === 'number' ? 'px-3 py-2 text-right font-number' : 'px-3 py-2'
                      }
                    >
                      {row[c.name] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>
    </AppShell>
  );
}
