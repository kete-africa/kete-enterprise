import { Button, PageSection, PageTitle, Panel, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { chat, fetchAssistant, type ChatMessage } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/assistant')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchAssistant(),
  component: AssistantPage,
});

/**
 * The assistant (spec 014): it acts for the person with her tools and her rights — those of the
 * gateway a copilot reaches — prepares and explains, and never decides for her.
 */
function AssistantPage() {
  const { me } = Route.useRouteContext();
  const assistant = Route.useLoaderData();
  const [messages, setMessages] = useState<(ChatMessage & { tools?: string[] })[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = [m.assistant_try_late(), m.assistant_try_team(), m.assistant_try_week()];
  const send = (text: string) => {
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError(null);
    void chat({ data: { messages: next.map(({ role, content }) => ({ role, content })) } })
      .then((answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        setMessages([...next, { role: 'assistant', content: answer.text, tools: answer.tools }]);
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };
  return (
    <AppShell me={me} current="assistant">
      <PageTitle>{m.nav_assistant()}</PageTitle>
      <p className="text-fg-muted">{m.assistant_explain()}</p>
      {!assistant.available ? (
        <PageSection first>
          <Panel>
            <p>{m.assistant_unavailable()}</p>
          </Panel>
        </PageSection>
      ) : (
        <PageSection first>
          <div className="grid gap-3">
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="secondary" onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
            {messages.map((message, i) => (
              <div
                key={i}
                className={`max-w-3xl rounded-box px-4 py-3 ${message.role === 'user' ? 'ml-auto bg-surface-selected' : 'border border-line bg-surface'}`}
              >
                <p className="whitespace-pre-line">{message.content}</p>
                {message.tools && message.tools.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {message.tools.map((tool, j) => (
                      <Tag key={j} tone="agent">
                        {m.assistant_used({ tool })}
                      </Tag>
                    ))}
                  </p>
                )}
              </div>
            ))}
            {busy && <p className="text-body-sm text-fg-muted">{m.assistant_thinking()}</p>}
            {error && (
              <p role="alert" className="text-body-sm text-state-error-fg">
                {error}
              </p>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) send(draft.trim());
              }}
            >
              <label className="flex min-w-72 flex-1 flex-col gap-1.5 text-body-sm font-semibold text-fg">
                {m.assistant_message()}
                <textarea
                  className="min-h-20 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy || !draft.trim()}>
                {m.assistant_send()}
              </Button>
            </form>
            {assistant.model && (
              <p className="text-body-sm text-fg-muted">
                {m.assistant_model({ model: assistant.model })}
              </p>
            )}
          </div>
        </PageSection>
      )}
    </AppShell>
  );
}
