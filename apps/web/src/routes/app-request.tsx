import { Button, Facts, PageHeader, Panel } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { actOnAppRequest, fetchAppRequest } from '@/lib/app-requests';
import { criticalityWords, dataLabel, StatusTag } from '@/lib/app-requests-view';
import { DialogForm, refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ressources/demandes/$requestId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchAppRequest({ data: { requestId: params.requestId } }),
  component: AppRequestPage,
});

const link = (href: string, text: string) => (
  <a href={href} className="font-semibold text-link underline" target="_blank" rel="noreferrer">
    {text}
  </a>
);

/**
 * One app request (spec 021): what was asked, where it stands, and the gesture this person may
 * make — withdraw it (hers, undecided), approve or refuse it (IT, never her own), send it again to
 * the factory (IT). Each decision opens in a dialog.
 */
function AppRequestPage() {
  const { me } = Route.useRouteContext();
  const { request, reviews, factory } = Route.useLoaderData();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const mine = request.requesterUserId === me.userId;

  const act = (gesture: 'withdraw' | 'approve' | 'refuse' | 'send') => {
    setBusy(true);
    setNotice(null);
    void actOnAppRequest({
      data: {
        key: crypto.randomUUID(),
        requestId: request.requestId,
        gesture,
        ...(gesture === 'refuse' ? { reason } : {}),
      },
    })
      .then(async (answer) => {
        setNotice(
          answer.ok ? { ok: true, text: m.apr_done() } : { ok: false, text: refusal(answer.error) },
        );
        await router.invalidate();
      })
      .catch(() => setNotice({ ok: false, text: m.error_generic() }))
      .finally(() => setBusy(false));
  };

  const decidable = reviews && !mine && request.status === 'submitted';
  return (
    <AppShell me={me} current="resources">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[
          { label: m.nav_resources(), href: '/ressources' },
          { label: m.apr_title(), href: '/ressources/demandes' },
        ]}
        title={request.name}
        description={request.purpose}
        actions={
          <>
            {request.status === 'ready' && request.url && (
              <a
                href={request.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-(--control-height) items-center rounded-control bg-action px-(--control-padding) font-semibold text-on-action hover:bg-action-strong"
              >
                {m.apr_open_app()}
              </a>
            )}
            {decidable && (
              <>
                <DialogForm
                  title={m.apr_approve_title()}
                  label={m.apr_approve()}
                  trigger="primary"
                  ready
                  busy={busy}
                  onSubmit={() => act('approve')}
                >
                  <p className="text-body">{m.apr_approve_body()}</p>
                </DialogForm>
                <DialogForm
                  title={m.apr_refuse_title()}
                  label={m.apr_refuse()}
                  ready={reason.trim().length > 0}
                  busy={busy}
                  onSubmit={() => act('refuse')}
                >
                  <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
                    {m.apr_reason()}
                    <textarea
                      className="min-h-28 rounded-control border border-line-control bg-surface-control p-3 font-normal text-fg"
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                </DialogForm>
              </>
            )}
            {mine && request.status === 'submitted' && (
              <Button variant="secondary" disabled={busy} onClick={() => act('withdraw')}>
                {m.apr_withdraw()}
              </Button>
            )}
            {reviews && factory && (request.status === 'queued' || request.status === 'failed') && (
              <Button variant="secondary" disabled={busy} onClick={() => act('send')}>
                {m.apr_send_again()}
              </Button>
            )}
          </>
        }
      />
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`text-body-sm ${notice.ok ? 'text-fg-muted' : 'text-state-error-fg'}`}
        >
          {notice.text}
        </p>
      )}
      <Panel>
        <Facts
          items={[
            { label: m.apr_status(), value: <StatusTag status={request.status} /> },
            { label: m.apr_requester(), value: request.requesterName },
            { label: m.apr_asked_on(), value: request.createdAt.slice(0, 10) },
            { label: m.apr_slug(), value: `kete-${request.slug}` },
            { label: m.apr_users(), value: request.users },
            { label: m.apr_owner(), value: request.ownerContact },
            { label: m.apr_data(), value: request.dataCategories.map(dataLabel).join(', ') },
            { label: m.apr_criticality(), value: criticalityWords[request.criticality]() },
            ...(request.refusalReason
              ? [{ label: m.apr_refusal(), value: request.refusalReason }]
              : []),
            ...(request.repository
              ? [
                  {
                    label: m.apr_repository(),
                    value: link(`https://github.com/${request.repository}`, request.repository),
                  },
                ]
              : []),
            ...(request.url
              ? [{ label: m.apr_address(), value: link(request.url, request.url) }]
              : []),
            ...(request.pullRequest
              ? [
                  {
                    label: m.apr_pull_request(),
                    value: link(request.pullRequest, request.pullRequest),
                  },
                ]
              : []),
            ...(request.error
              ? [
                  {
                    label: m.apr_error(),
                    value: request.error.startsWith('factory_')
                      ? refusal(request.error)
                      : request.error,
                  },
                ]
              : []),
          ]}
        />
      </Panel>
    </AppShell>
  );
}
