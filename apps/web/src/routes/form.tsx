import { Button, PageHeader, PageSection, Panel, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  collectionGesture,
  fetchCollection,
  submitAnswers,
  type Submission,
} from '@/lib/collections';
import { FormFill } from '@/lib/form-fields';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/formulaires/$collectionId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchCollection({ data: { collectionId: params.collectionId } }),
  component: FormPage,
});

const statusLabel = (status: Submission['status']) =>
  ({
    received: m.forms_status_received,
    pending: m.forms_status_pending,
    approved: m.forms_status_approved,
    refused: m.forms_status_refused,
  })[status]();

/** One form (spec 032): filled in here; for who runs it, its answers, its link, open or closed. */
function FormPage() {
  const { me } = Route.useRouteContext();
  const { collection, manage, submissions } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const run = <T,>(
    work: () => Promise<{ ok: boolean; error: string | null; data: T | null }>,
    done: (data: T | null) => string | null,
  ) => {
    setBusy(true);
    setNotice(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) return setNotice({ ok: false, text: refusal(answer.error) });
        const text = done(answer.data);
        if (text) setNotice({ ok: true, text });
        await router.invalidate();
      })
      .catch(() => setNotice({ ok: false, text: m.error_generic() }))
      .finally(() => setBusy(false));
  };
  return (
    <AppShell me={me} current="forms">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.forms_title(), href: '/formulaires' }]}
        title={collection.name}
        {...(collection.description ? { description: collection.description } : {})}
        actions={
          manage ? (
            <>
              <Button
                variant="secondary"
                disabled={busy || !collection.open}
                onClick={() =>
                  run(
                    () =>
                      collectionGesture({
                        data: { collectionId: collection.collectionId, link: true },
                      }),
                    (data) => (data?.url ? m.forms_link_ready({ url: data.url }) : null),
                  )
                }
              >
                {m.forms_link()}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      collectionGesture({
                        data: { collectionId: collection.collectionId, open: !collection.open },
                      }),
                    () => null,
                  )
                }
              >
                {collection.open ? m.forms_close() : m.forms_reopen()}
              </Button>
            </>
          ) : undefined
        }
      />
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={notice.ok ? 'break-all' : 'text-state-error-fg'}
        >
          {notice.text}
        </p>
      )}
      {!collection.open && <Tag>{m.forms_closed()}</Tag>}
      {collection.open && collection.answeredBy === 'everyone' && (
        <PageSection first title={m.forms_answer()}>
          <Panel>
            <FormFill
              key={submissions.length}
              fields={collection.fields}
              busy={busy}
              onSend={(values) =>
                run(
                  () => submitAnswers({ data: { collectionId: collection.collectionId, values } }),
                  () => m.forms_sent(),
                )
              }
            />
          </Panel>
        </PageSection>
      )}
      <PageSection title={m.forms_submissions()}>
        {manage && <p className="text-body-sm text-fg-muted">{m.forms_circuit_hint()}</p>}
        <div className="overflow-x-auto rounded-box border border-line">
          <table className="w-full text-body-sm">
            <thead className="bg-surface-muted text-left">
              <tr>
                <th className="px-3 py-2" />
                {collection.fields.map((f) => (
                  <th key={f.key} className="px-3 py-2 font-semibold">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.submissionId} className="border-t border-line">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(s.createdAt).toLocaleDateString(getLocale())}
                    {s.submitterName ? ` · ${s.submitterName}` : ''}
                  </td>
                  {collection.fields.map((f) => {
                    const v = s.values[f.key];
                    return (
                      <td key={f.key} className="px-3 py-2">
                        {v === true ? m.forms_yes() : v === false ? m.forms_no() : (v ?? '')}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <Tag>{statusLabel(s.status)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>
    </AppShell>
  );
}
