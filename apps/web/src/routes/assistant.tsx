import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { EmptyState, Icon, PageHeader, Row, RowList } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { fetchMentionables } from '@/lib/chat/api';
import { fetchViewSandbox } from '@/lib/chat/views';
import { ChatCanvas } from '@/lib/chat/canvas';
import { PayWith, rememberedPayer } from '@/lib/chat/pay-with';
import { useKeteChat } from '@/lib/chat/runtime';
import { KeteThread, triggerAdapter } from '@/lib/chat/thread';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchAssistant, fetchConversation, fetchConversations, type Payer } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';

const isConversation = (value: unknown): value is string =>
  typeof value === 'string' && /^cnv_[0-9a-f-]{8,64}$/.test(value);

export const Route = createFileRoute('/assistant')({
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    isConversation(search['c']) ? { c: search['c'] } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ c: search.c }),
  loader: async ({ deps }) => {
    const [assistant, list, current, mentionables, sandbox] = await Promise.all([
      fetchAssistant(),
      fetchConversations(),
      deps.c ? fetchConversation({ data: { conversationId: deps.c } }) : Promise.resolve(null),
      fetchMentionables(),
      fetchViewSandbox().catch(() => null),
    ]);
    return {
      assistant,
      conversations: list.conversations,
      current,
      mentionables,
      sandboxUrl: sandbox?.url ?? null,
    };
  },
  component: AssistantPage,
});

/**
 * The assistant (specs 014, 017, 027), on assistant-ui: her conversations beside the thread; the
 * answer streamed and formatted, its tools as cards, its drafts to decide right here, its sources;
 * files attached and read; people and apps mentioned (@), commands (/), dictation; and the canvas
 * beside it when the assistant writes a document. It acts with her rights and prepares — she
 * decides.
 */
function AssistantPage() {
  const { me } = Route.useRouteContext();
  const { assistant, conversations, current, mentionables, sandboxUrl } = Route.useLoaderData();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ title: string; content: string } | null>(null);
  const [closed, setClosed] = useState(false);
  const [payer, setPayer] = useState<Payer | null>(assistant.payers[0] ?? null);
  // The payer she chose last on this device, once the page runs in her browser.
  useEffect(() => setPayer(rememberedPayer(assistant.payers)), [assistant.payers]);
  const chat = useKeteChat({
    conversationId: current?.conversationId ?? null,
    initial: current?.messages ?? [],
    payer,
    onError: (code) => setError(code === null ? null : refusal(code)),
  });
  const canvas = opened ?? (closed ? null : chat.canvas);

  const mentions = useMemo(
    () =>
      triggerAdapter([
        {
          id: 'people',
          label: m.chat_category_people(),
          items: mentionables.people.map((p) => ({
            id: p.userId,
            type: 'person',
            label: p.name,
            ...(p.detail ? { description: p.detail } : {}),
          })),
        },
        {
          id: 'apps',
          label: m.chat_category_apps(),
          items: me.apps.map((a) => ({ id: a.resourceId, type: 'app', label: a.name })),
        },
      ]),
    [mentionables, me.apps],
  );
  const commands = useMemo(
    () =>
      triggerAdapter([
        {
          id: 'commands',
          label: m.chat_category_commands(),
          items: [
            { id: 'summarize', label: m.cmd_summarize(), description: m.cmd_summarize_body() },
            { id: 'write', label: m.cmd_write(), description: m.cmd_write_body() },
            { id: 'table', label: m.cmd_table(), description: m.cmd_table_body() },
            { id: 'explain', label: m.cmd_explain(), description: m.cmd_explain_body() },
            { id: 'actions', label: m.cmd_actions(), description: m.cmd_actions_body() },
          ].map((item) => ({ ...item, type: 'command' })),
        },
      ]),
    [],
  );

  return (
    <AppShell me={me} current="assistant">
      <PageHeader
        title={m.nav_assistant()}
        description={m.assistant_explain()}
        actions={
          <>
            <a
              href="/assistant/memoire"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
            >
              {m.memory_link()}
            </a>
            <a
              href="/assistant/taches"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
            >
              {m.schedules_link()}
            </a>
            <a
              href="/assistant/connexion"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
            >
              {m.assistant_connection_link()}
            </a>
          </>
        }
      />
      {!assistant.available ? (
        <EmptyState title={m.assistant_unavailable()} />
      ) : (
        <div
          className={`grid gap-6 ${
            canvas
              ? 'min-[1101px]:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]'
              : 'min-[1101px]:grid-cols-[230px_minmax(0,1fr)]'
          }`}
        >
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
          <div className="flex min-w-0 flex-col">
            <AssistantRuntimeProvider runtime={chat.runtime}>
              <KeteThread
                welcome={m.assistant_welcome({ name: me.name })}
                suggestions={[
                  m.assistant_suggestion_day(),
                  m.assistant_suggestion_late(),
                  m.assistant_suggestion_readings(),
                  m.assistant_suggestion_team(),
                ]}
                mentions={mentions}
                commands={commands}
                hint={
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {m.chat_hint({
                        model:
                          payer === 'subscription'
                            ? ''
                            : assistant.model
                              ? m.assistant_hint({ model: assistant.model })
                              : m.assistant_hint_rules(),
                      })}
                    </span>
                    <PayWith payers={assistant.payers} value={payer} onChange={setPayer} />
                  </span>
                }
                views={{
                  sandboxUrl,
                  openCanvas: (document) => {
                    setClosed(false);
                    setOpened(document);
                  },
                }}
              />
            </AssistantRuntimeProvider>
            {error && (
              <p role="alert" className="text-body-sm text-state-error-fg">
                {error}
              </p>
            )}
          </div>
          {canvas && (
            <ChatCanvas
              canvas={canvas}
              onClose={() => {
                setOpened(null);
                setClosed(true);
              }}
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
