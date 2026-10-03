import {
  ChatMessage,
  ChatThread,
  Composer,
  CopyButton,
  EmptyState,
  Icon,
  IconButton,
  Markdown,
  PageHeader,
  Row,
  RowList,
  Suggestions,
  ToolCard,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { DraftCard } from '@/lib/draft-card';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import {
  fetchAssistant,
  fetchConversation,
  fetchConversations,
  type DraftReview,
} from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';

const isConversation = (value: unknown): value is string =>
  typeof value === 'string' && /^cnv_[0-9a-f-]{8,64}$/.test(value);

export const Route = createFileRoute('/assistant')({
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    isConversation(search['c']) ? { c: search['c'] } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ c: search.c }),
  loader: async ({ deps }) => {
    const [assistant, list, current] = await Promise.all([
      fetchAssistant(),
      fetchConversations(),
      deps.c ? fetchConversation({ data: { conversationId: deps.c } }) : Promise.resolve(null),
    ]);
    return { assistant, conversations: list.conversations, current };
  },
  component: AssistantPage,
});

type Tool = { name: string; state: 'running' | 'done' | 'refused' };
type Message = {
  role: 'user' | 'assistant';
  content: string;
  tools: Tool[];
  drafts: DraftReview[];
};

/** The words of a tool the assistant called. */
function toolLabel(name: string): string {
  const labels: Record<string, () => string> = {
    my_day: m.tool_my_day,
    structure_chart: m.tool_structure_chart,
    registry_list: m.tool_registry_list,
    registry_register: m.tool_registry_register,
    decisions_inbox: m.tool_decisions_inbox,
    performance_readings_to_take: m.tool_readings_to_take,
    performance_propose_measure: m.tool_propose_measure,
    actions_propose: m.tool_actions_propose,
  };
  return labels[name]?.() ?? name;
}

const toolState = (state: Tool['state']) =>
  ({ running: m.tool_running, done: m.tool_done, refused: m.tool_refused })[state]();

/**
 * The assistant (spec 014, 017): her conversations kept and listed beside the thread; the answer
 * streamed and formatted; each tool it used as a card; each draft it prepared to validate or refuse
 * right here; a composer pinned at the bottom that can stop an answer. It acts with her rights and
 * prepares — she decides.
 */
function AssistantPage() {
  const { me } = Route.useRouteContext();
  const { assistant, conversations, current } = Route.useLoaderData();
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(
    current?.conversationId ?? null,
  );
  const [messages, setMessages] = useState<Message[]>(
    (current?.messages ?? []).map((msg) => ({
      role: msg.role,
      content: msg.content,
      tools: msg.tools,
      drafts: msg.drafts,
    })),
  );
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const suggestions = [
    m.assistant_suggestion_day(),
    m.assistant_suggestion_late(),
    m.assistant_suggestion_readings(),
    m.assistant_suggestion_team(),
  ];

  /** Updates the answer being written: the last message. */
  const patchLast = (change: (last: Message) => Message) =>
    setMessages((list) => [...list.slice(0, -1), change(list[list.length - 1] as Message)]);

  const send = async (text: string) => {
    setError(null);
    setDraft('');
    setBusy(true);
    setMessages((list) => [
      ...list,
      { role: 'user', content: text, tools: [], drafts: [] },
      { role: 'assistant', content: '', tools: [], drafts: [] },
    ]);
    const controller = new AbortController();
    stopper.current = controller;
    try {
      const response = await fetch('/assistant/flux', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, ...(conversationId ? { conversationId } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const answer = (await response.json().catch(() => ({}))) as { error?: string };
        setError(refusal(answer.error ?? null));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            conversationId?: string;
            delta?: string;
            name?: string;
            state?: Tool['state'];
            draft?: Message['drafts'][number];
            code?: string;
          };
          if (event.type === 'conversation' && event.conversationId && !conversationId) {
            setConversationId(event.conversationId);
            // The address follows the conversation, without reloading the thread.
            window.history.replaceState(null, '', `/assistant?c=${event.conversationId}`);
          } else if (event.type === 'text') {
            patchLast((last) => ({ ...last, content: last.content + (event.delta ?? '') }));
          } else if (event.type === 'tool' && event.name) {
            const tool: Tool = { name: event.name, state: event.state ?? 'done' };
            const prepared = event.draft;
            patchLast((last) => ({
              ...last,
              tools:
                tool.state === 'running'
                  ? [...last.tools, tool]
                  : [
                      ...last.tools.filter((t) => !(t.name === tool.name && t.state === 'running')),
                      tool,
                    ],
              drafts: prepared ? [...last.drafts, prepared] : last.drafts,
            }));
          } else if (event.type === 'error') {
            setError(refusal(event.code ?? null));
          }
        }
      }
    } catch (failure) {
      if ((failure as Error).name !== 'AbortError') setError(m.error_generic());
    } finally {
      stopper.current = null;
      setBusy(false);
      void router.invalidate();
    }
  };

  const lastQuestion = [...messages].reverse().find((msg) => msg.role === 'user')?.content;

  return (
    <AppShell me={me} current="assistant">
      <PageHeader
        title={m.nav_assistant()}
        description={m.assistant_explain()}
        actions={
          <a
            href="/assistant/connexion"
            className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
          >
            {m.assistant_connection_link()}
          </a>
        }
      />
      {!assistant.available ? (
        <EmptyState title={m.assistant_unavailable()} />
      ) : (
        <div className="grid gap-6 min-[1101px]:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label={m.assistant_conversations()} className="flex flex-col gap-3">
            <a
              href="/assistant"
              className="inline-flex h-(--control-height) items-center gap-2 rounded-control border border-line-control px-3 font-semibold text-fg hover:bg-surface-hover"
            >
              <Icon name="new" size={18} />
              {m.assistant_new()}
            </a>
            {conversations.length > 0 && (
              <RowList label={m.assistant_conversations()}>
                {conversations.map((c) => (
                  <Row
                    key={c.conversationId}
                    href={`/assistant?c=${c.conversationId}`}
                    title={c.title}
                  />
                ))}
              </RowList>
            )}
          </nav>
          <div className="flex min-h-[60vh] min-w-0 flex-col">
            <div className="flex-1">
              {messages.length === 0 ? (
                <div className="flex flex-col gap-4 py-6">
                  <p className="font-heading text-title">
                    {m.assistant_welcome({ name: me.name })}
                  </p>
                  <Suggestions
                    label={m.assistant_suggestions()}
                    items={suggestions}
                    onSelect={(text) => void send(text)}
                  />
                </div>
              ) : (
                <ChatThread label={m.assistant_thread()}>
                  {messages.map((msg, i) => {
                    if (msg.role === 'user') {
                      return (
                        <ChatMessage key={i} role="user">
                          {msg.content}
                        </ChatMessage>
                      );
                    }
                    const writing = busy && i === messages.length - 1;
                    return (
                      <ChatMessage
                        key={i}
                        role="assistant"
                        author={m.nav_assistant()}
                        {...(msg.tools.length > 0
                          ? {
                              tools: msg.tools.map((tool, j) => (
                                <ToolCard
                                  key={j}
                                  name={toolLabel(tool.name)}
                                  state={tool.state}
                                  stateLabel={toolState(tool.state)}
                                />
                              )),
                            }
                          : {})}
                        {...(msg.content && !writing
                          ? {
                              actions: (
                                <>
                                  <CopyButton
                                    text={msg.content}
                                    label={m.common_copy()}
                                    copiedLabel={m.common_copied()}
                                  />
                                  {i === messages.length - 1 && lastQuestion && (
                                    <IconButton
                                      label={m.assistant_again()}
                                      onClick={() => void send(lastQuestion)}
                                    >
                                      <Icon name="refresh" size={16} />
                                    </IconButton>
                                  )}
                                </>
                              ),
                            }
                          : {})}
                      >
                        {msg.content ? (
                          <Markdown text={msg.content} />
                        ) : (
                          writing && <p className="text-fg-muted">{m.assistant_thinking()}</p>
                        )}
                        {msg.drafts.length > 0 && (
                          <div className="mt-3 grid gap-3">
                            {msg.drafts.map((d) => (
                              <DraftCard key={d.draftId} draft={d} />
                            ))}
                          </div>
                        )}
                      </ChatMessage>
                    );
                  })}
                </ChatThread>
              )}
              {error && (
                <p role="alert" className="text-body-sm text-state-error-fg">
                  {error}
                </p>
              )}
            </div>
            <Composer
              label={m.assistant_message()}
              placeholder={m.assistant_placeholder()}
              value={draft}
              onChange={setDraft}
              onSend={() => void send(draft.trim())}
              onStop={() => stopper.current?.abort()}
              busy={busy}
              sendLabel={m.assistant_send()}
              stopLabel={m.assistant_stop()}
              hint={
                assistant.model
                  ? m.assistant_hint({ model: assistant.model })
                  : m.assistant_hint_rules()
              }
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
