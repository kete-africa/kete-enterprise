import {
  Button,
  EmptyState,
  PageHeader,
  PageSection,
  Tag,
  TextField,
  type TagTone,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import {
  askColleague,
  fetchRequests,
  type ColleagueRequest,
  type RequestStatus,
} from '@/lib/requests';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/demandes')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRequests(),
  component: RequestsPage,
});

export const statusWords: Record<RequestStatus, () => string> = {
  received: m.requests_status_received,
  taken: m.requests_status_taken,
  waiting: m.requests_status_waiting,
  returned: m.requests_status_returned,
  declined: m.requests_status_declined,
  cancelled: m.requests_status_cancelled,
};
export const statusTone: Record<RequestStatus, TagTone> = {
  received: 'info',
  taken: 'agent',
  waiting: 'verify',
  returned: 'validated',
  declined: 'error',
  cancelled: 'neutral',
};

function RequestRow({ request, mine }: { request: ColleagueRequest; mine: 'sent' | 'received' }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <a href={`/demandes/${request.requestId}`} className="font-semibold text-link underline">
          {request.title}
        </a>
        <p className="text-body-sm text-fg-muted">
          {mine === 'sent'
            ? m.requests_to({ name: request.to.name })
            : m.requests_from({ name: request.from.name })}
          {request.dueOn ? ` · ${m.requests_due({ date: request.dueOn })}` : ''}
        </p>
      </div>
      <Tag tone={statusTone[request.status]}>{statusWords[request.status]()}</Tag>
    </li>
  );
}

/**
 * Requests to colleagues (spec 065, doctrine D-044): work asked of a person, with its state. What
 * she was asked; what she asked — and a new request.
 */
function RequestsPage() {
  const { me } = Route.useRouteContext();
  const { sent, received } = Route.useLoaderData();
  const router = useRouter();
  const [colleague, setColleague] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AppShell me={me} current="requests">
      <PageHeader title={m.requests_title()} description={m.requests_explain()} />
      <PageSection title={m.requests_received()}>
        {received.length === 0 ? (
          <EmptyState title={m.requests_none_received()} />
        ) : (
          <ul className="divide-y divide-line">
            {received.map((request) => (
              <RequestRow key={request.requestId} request={request} mine="received" />
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.requests_sent()}>
        {sent.length === 0 ? (
          <EmptyState title={m.requests_none_sent()} />
        ) : (
          <ul className="divide-y divide-line">
            {sent.map((request) => (
              <RequestRow key={request.requestId} request={request} mine="sent" />
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.requests_new()}>
        <form
          className="grid gap-3 md:max-w-xl"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const answer = await askColleague({ data: { colleague, title, detail, dueOn } });
            setPending(false);
            if (!answer.ok) {
              setError(refusal(answer.error));
              return;
            }
            setColleague('');
            setTitle('');
            setDetail('');
            setDueOn('');
            await router.navigate({ to: `/demandes/${answer.data.request.requestId}` });
          }}
        >
          <TextField
            label={m.requests_colleague()}
            hint={m.requests_colleague_hint()}
            value={colleague}
            onChange={(event) => setColleague(event.target.value)}
            required
          />
          <TextField
            label={m.requests_what()}
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
            {m.requests_detail()}
            <textarea
              value={detail}
              maxLength={4000}
              rows={3}
              onChange={(event) => setDetail(event.target.value)}
              className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal text-fg"
            />
          </label>
          <TextField
            type="date"
            label={m.requests_due_label()}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending || !colleague.trim() || !title.trim()}>
              {m.requests_send()}
            </Button>
          </div>
        </form>
      </PageSection>
    </AppShell>
  );
}
