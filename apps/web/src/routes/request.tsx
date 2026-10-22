import { Button, EmptyState, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import {
  fetchOwnAgents,
  fetchRequest,
  moveRequest,
  type Move,
  type RequestEvent,
} from '@/lib/requests';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { statusTone, statusWords } from './requests';

export const Route = createFileRoute('/demandes/$requestId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => {
    const [request, agents] = await Promise.all([
      fetchRequest({ data: { requestId: params.requestId } }),
      fetchOwnAgents(),
    ]);
    return { request, agents };
  },
  component: RequestPage,
});

const eventWords: Record<RequestEvent['kind'], (name: string) => string> = {
  asked: (name) => m.request_event_asked({ name }),
  taken: (name) => m.request_event_taken({ name }),
  handed: (name) => m.request_event_handed({ name }),
  waiting: (name) => m.request_event_waiting({ name }),
  answered: (name) => m.request_event_answered({ name }),
  note: (name) => m.request_event_note({ name }),
  returned: (name) => m.request_event_returned({ name }),
  declined: (name) => m.request_event_declined({ name }),
  cancelled: (name) => m.request_event_cancelled({ name }),
  reminded: (name) => m.request_event_reminded({ name }),
  agent_done: (name) => m.request_event_agent_done({ name }),
};

const when = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * One request (spec 065): its state, its thread — the two people, and her agent when she handed it
 * the work — and the gestures each one has. What goes back is signed by the person asked.
 */
function RequestPage() {
  const { me } = Route.useRouteContext();
  const { request, agents } = Route.useLoaderData();
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!request) {
    return (
      <AppShell me={me} current="requests">
        <EmptyState title={m.request_not_found()} />
      </AppShell>
    );
  }
  const mine = request.to.userId === me.userId ? 'to' : 'from';
  const open = ['received', 'taken', 'waiting'].includes(request.status);
  const prepared = request.events.findLast((event) => event.kind === 'agent_done' && event.text);
  const requestId = request.requestId;

  async function act(move: Move) {
    setPending(true);
    setError(null);
    const answer = await moveRequest({ data: { requestId, move } });
    setPending(false);
    if (!answer.ok) {
      setError(refusal(answer.error));
      return;
    }
    setText('');
    await router.invalidate();
  }

  return (
    <AppShell me={me} current="requests">
      <PageHeader
        breadcrumbs={[{ label: m.requests_title(), href: '/demandes' }]}
        title={request.title}
        status={<Tag tone={statusTone[request.status]}>{statusWords[request.status]()}</Tag>}
        description={
          mine === 'to'
            ? m.requests_from({ name: request.from.name })
            : m.requests_to({ name: request.to.name })
        }
      />
      {request.returned && (
        <PageSection title={m.request_returned_title()}>
          <p className="whitespace-pre-wrap">{request.returned.text}</p>
          <p className="mt-2 text-body-sm text-fg-muted">
            {request.returned.preparedBy
              ? m.request_signed_prepared({
                  name: request.to.name,
                  agent: request.agent?.name ?? '',
                })
              : m.request_signed({ name: request.to.name })}
          </p>
        </PageSection>
      )}
      <PageSection title={m.request_thread()}>
        <ol className="grid gap-3">
          {request.events.map((event, index) => (
            <li key={index} className="grid gap-1 rounded-control bg-surface px-3 py-2">
              <p className="text-body-sm text-fg-muted">
                {event.actor.kind === 'agent' && <Tag tone="agent">{m.request_agent_tag()}</Tag>}{' '}
                {eventWords[event.kind](event.actor.name)} · {when(event.at)}
              </p>
              {event.text && <p className="whitespace-pre-wrap">{event.text}</p>}
            </li>
          ))}
        </ol>
        {request.agent && request.agent.work !== 'done' && request.agent.work !== null && (
          <p className="mt-3 text-body-sm text-fg-muted">
            {m.request_agent_working({ name: request.agent.name })}
          </p>
        )}
      </PageSection>
      {open && (
        <PageSection title={m.request_act()}>
          <div className="grid gap-3 md:max-w-2xl">
            <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
              {mine === 'to' ? m.request_text_to() : m.request_text_from()}
              <textarea
                value={text}
                rows={4}
                maxLength={8000}
                onChange={(event) => setText(event.target.value)}
                className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal text-fg"
              />
            </label>
            {mine === 'to' && prepared && (
              <button
                type="button"
                onClick={() => setText(prepared.text)}
                className="justify-self-start text-body-sm font-semibold text-link underline"
              >
                {m.request_use_prepared({ name: prepared.actor.name })}
              </button>
            )}
            {error && (
              <p role="alert" className="text-body-sm text-state-error-fg">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {mine === 'to' ? (
                <>
                  <Button
                    disabled={pending || !text.trim()}
                    onClick={() => void act({ kind: 'return', text })}
                  >
                    {m.request_return()}
                  </Button>
                  {request.status === 'received' && (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void act({ kind: 'take' })}
                    >
                      {m.request_take()}
                    </Button>
                  )}
                  {agents.map((agent) => (
                    <Button
                      key={agent.agentId}
                      variant="secondary"
                      disabled={pending || request.agent?.agentId === agent.agentId}
                      onClick={() => void act({ kind: 'hand', agentId: agent.agentId })}
                    >
                      {m.request_hand({ name: agent.name })}
                    </Button>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={pending || !text.trim()}
                    onClick={() => void act({ kind: 'wait', question: text })}
                  >
                    {m.request_ask_back()}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pending || !text.trim()}
                    onClick={() => void act({ kind: 'decline', reason: text })}
                  >
                    {m.request_decline()}
                  </Button>
                </>
              ) : (
                <>
                  {request.status === 'waiting' ? (
                    <Button
                      disabled={pending || !text.trim()}
                      onClick={() => void act({ kind: 'answer', text })}
                    >
                      {m.request_answer()}
                    </Button>
                  ) : (
                    <Button
                      disabled={pending || !text.trim()}
                      onClick={() => void act({ kind: 'note', text })}
                    >
                      {m.request_note()}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void act({ kind: 'remind' })}
                  >
                    {m.request_remind()}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void act({ kind: 'cancel' })}
                  >
                    {m.request_cancel()}
                  </Button>
                </>
              )}
            </div>
          </div>
        </PageSection>
      )}
    </AppShell>
  );
}
