import { Button, EmptyState, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  allowSubjects,
  declineExchange,
  fetchExchanges,
  replyExchange,
  subjects,
  withdrawExchange,
  type Exchange,
  type Subject,
} from '@/lib/exchanges';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/assistant/echanges')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchExchanges(),
  component: ExchangesPage,
});

const subjectWords: Record<Exchange['subject'], () => string> = {
  availability: m.exchanges_subject_availability,
  workload: m.exchanges_subject_workload,
  other: m.exchanges_subject_other,
};
const subjectExplain: Record<Subject, () => string> = {
  availability: m.exchanges_allow_availability,
  workload: m.exchanges_allow_workload,
};
const statusWords: Record<Exchange['status'], () => string> = {
  answered: m.exchanges_status_answered,
  waiting: m.exchanges_status_waiting,
  replied: m.exchanges_status_replied,
  declined: m.exchanges_status_declined,
  withdrawn: m.exchanges_status_withdrawn,
};
const statusTone = (status: Exchange['status']) =>
  status === 'waiting' ? 'info' : status === 'declined' ? 'error' : 'validated';

/**
 * « Entre assistants » (spec 057): what her assistant may answer alone to a colleague's, what
 * colleagues' assistants asked — answered alone or waiting for her — and what hers asked.
 */
function ExchangesPage() {
  const { me } = Route.useRouteContext();
  const { allowed, received, sent } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const own = !me.viewedBy;
  const gesture = (work: () => Promise<{ ok: boolean; error: string | null }>) => {
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
  const when = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  const line = (exchange: Exchange, who: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Tag tone={statusTone(exchange.status)}>{statusWords[exchange.status]()}</Tag>
      <span className="font-semibold">{who}</span>
      <span className="text-body-sm text-fg-muted">
        {subjectWords[exchange.subject]()} · {when(exchange.createdAt)}
      </span>
    </div>
  );
  return (
    <AppShell me={me} current="assistant">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_assistant(), href: '/assistant' }]}
        title={m.exchanges_title()}
        description={m.exchanges_explain()}
      />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}

      <PageSection first title={m.exchanges_allow_title()}>
        <p className="text-body-sm text-fg-muted">{m.exchanges_allow_explain()}</p>
        <div className="mt-3 grid gap-3">
          {subjects.map((subject) => (
            <label key={subject} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={allowed.includes(subject)}
                disabled={busy || !own}
                onChange={(e) =>
                  gesture(() =>
                    allowSubjects({
                      data: {
                        allowed: e.target.checked
                          ? [...allowed, subject]
                          : allowed.filter((x) => x !== subject),
                      },
                    }),
                  )
                }
              />
              <span className="grid gap-0.5">
                <span className="font-semibold">{subjectWords[subject]()}</span>
                <span className="text-body-sm text-fg-muted">{subjectExplain[subject]()}</span>
              </span>
            </label>
          ))}
        </div>
      </PageSection>

      <PageSection title={m.exchanges_received()}>
        {received.length === 0 ? (
          <EmptyState title={m.exchanges_received_none()} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
            {received.map((exchange) => (
              <li key={exchange.exchangeId} className="grid gap-2 px-4 py-3">
                {line(exchange, m.exchanges_from({ name: exchange.from.name }))}
                <p className="whitespace-pre-wrap">{exchange.question}</p>
                {exchange.answer && (
                  <p className="text-body-sm whitespace-pre-wrap">
                    <span className="font-semibold">
                      {exchange.status === 'answered'
                        ? m.exchanges_said_alone()
                        : m.exchanges_you_said()}
                    </span>{' '}
                    {exchange.answer}
                  </p>
                )}
                {exchange.status === 'waiting' && own && (
                  <div className="grid gap-2">
                    <label className="grid gap-1.5 text-body-sm font-semibold">
                      {m.exchanges_your_answer()}
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={answers[exchange.exchangeId] ?? ''}
                        onChange={(e) =>
                          setAnswers({ ...answers, [exchange.exchangeId]: e.target.value })
                        }
                        className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy || !(answers[exchange.exchangeId] ?? '').trim()}
                        onClick={() =>
                          gesture(() =>
                            replyExchange({
                              data: {
                                exchangeId: exchange.exchangeId,
                                answer: answers[exchange.exchangeId] ?? '',
                              },
                            }),
                          )
                        }
                      >
                        {m.exchanges_reply()}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          gesture(() =>
                            declineExchange({ data: { exchangeId: exchange.exchangeId } }),
                          )
                        }
                      >
                        {m.exchanges_decline()}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title={m.exchanges_sent()}>
        {sent.length === 0 ? (
          <EmptyState title={m.exchanges_sent_none()} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
            {sent.map((exchange) => (
              <li key={exchange.exchangeId} className="grid gap-2 px-4 py-3">
                {line(exchange, m.exchanges_to({ name: exchange.to.name }))}
                <p className="whitespace-pre-wrap">{exchange.question}</p>
                {exchange.answer && (
                  <p className="text-body-sm whitespace-pre-wrap">
                    <span className="font-semibold">
                      {exchange.status === 'answered'
                        ? m.exchanges_their_assistant_said()
                        : m.exchanges_they_said({ name: exchange.to.name })}
                    </span>{' '}
                    {exchange.answer}
                  </p>
                )}
                {exchange.status === 'waiting' && own && (
                  <div>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        gesture(() =>
                          withdrawExchange({ data: { exchangeId: exchange.exchangeId } }),
                        )
                      }
                    >
                      {m.exchanges_withdraw()}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </AppShell>
  );
}
