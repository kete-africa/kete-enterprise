import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { Icon } from '@kete/design';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { refusal } from '@/lib/forms';
import { fetchAssistant, type Payer } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { rememberedPayer } from './pay-with';
import { useKeteChat } from './runtime';
import { KeteThread, triggerAdapter } from './thread';

// The assistant beside the page (spec 048): it knows what she is looking at, answers with its
// sources, and the conversation goes on in the assistant's page when she wants more room.

/** What a page shows the assistant: its kind, its title, its address. */
export interface AssistantPage {
  kind: string;
  title: string;
  href: string;
}

// What the current page shows: one at a time, set by the page, read by the shell around it.
let shown: AssistantPage | null = null;
const listeners = new Set<() => void>();
const show = (page: AssistantPage | null) => {
  shown = page;
  for (const listener of listeners) listener();
};

/** A page says what it shows, for the assistant beside it. */
export function useAssistantPage(page: AssistantPage | null) {
  const key = page ? `${page.kind}|${page.title}|${page.href}` : '';
  const latest = useRef(page);
  latest.current = page;
  useEffect(() => {
    show(latest.current);
    return () => show(null);
  }, [key]);
}

// A page asks the assistant beside it (spec 050): the shell opens it with the question.
const askers = new Set<(question: string) => void>();
export function askBeside(question: string) {
  for (const ask of askers) ask(question);
}
/** The shell listens for a page's question. */
export function useAskBeside(ask: (question: string) => void) {
  useEffect(() => {
    askers.add(ask);
    return () => {
      askers.delete(ask);
    };
  }, [ask]);
}

/** What the page shows, for the shell. */
export function useShownPage(): AssistantPage | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => null,
  );
}

const none = triggerAdapter([]);

/** The thread itself, once the assistant is known to answer. */
function PanelThread({
  page,
  question,
  payers,
}: {
  page: AssistantPage | null;
  question: string | null;
  payers: Payer[];
}) {
  const [error, setError] = useState<string | null>(null);
  const chat = useKeteChat({
    conversationId: null,
    initial: [],
    payer: rememberedPayer(payers),
    page,
    followAddress: false,
    onError: (code) => setError(code === null ? null : refusal(code)),
  });
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!question || asked.current === question) return;
    asked.current = question;
    void chat.send(question, []);
  }, [question, chat]);
  const answered = Boolean(chat.conversationId) && !chat.running;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AssistantRuntimeProvider runtime={chat.runtime}>
        <KeteThread
          welcome={page ? m.panel_seeing({ title: page.title }) : m.panel_welcome()}
          suggestions={page ? [m.panel_explain_page(), m.panel_next_step()] : []}
          mentions={none}
          commands={none}
          hint={null}
          views={{
            sandboxUrl: null,
            openCanvas: () => {
              if (chat.conversationId) window.location.href = `/assistant?c=${chat.conversationId}`;
            },
          }}
        />
      </AssistantRuntimeProvider>
      {answered && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-control border border-line-control px-3 py-1.5 text-body-sm font-semibold hover:bg-surface-hover"
            onClick={() => void chat.send(m.panel_pin_ask(), [])}
          >
            <Icon name="chart" size={16} />
            {m.panel_pin()}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-control border border-line-control px-3 py-1.5 text-body-sm font-semibold hover:bg-surface-hover"
            onClick={() => void chat.send(m.panel_every_monday_ask(), [])}
          >
            <Icon name="clock" size={16} />
            {m.panel_every_monday()}
          </button>
          <a
            href={`/assistant?c=${chat.conversationId ?? ''}`}
            className="inline-flex items-center gap-1.5 rounded-control border border-line-control px-3 py-1.5 text-body-sm font-semibold hover:bg-surface-hover"
          >
            <Icon name="external" size={16} />
            {m.panel_continue()}
          </a>
        </div>
      )}
      {error && (
        <p role="alert" className="pt-2 text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The assistant beside every screen (spec 048), in the drawer of the frame (@kete/shell; step C1).
 * A new question — from Ctrl K — starts a new conversation; closing the drawer keeps nothing but the
 * conversation, found again in the assistant.
 */
export function AssistantBeside({
  page,
  question,
}: {
  page: AssistantPage | null;
  question: { text: string; at: number } | null;
}) {
  const [state, setState] = useState<{ available: boolean; payers: Payer[] } | null>(null);
  useEffect(() => {
    if (state) return;
    void fetchAssistant()
      .then((a) => setState({ available: a.available, payers: a.payers }))
      .catch(() => setState({ available: false, payers: [] }));
  }, [state]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        {page ? (
          <p className="flex min-w-0 items-center gap-1.5 text-body-sm text-fg-muted">
            <Icon name="search" size={14} />
            {m.panel_seeing_short()}{' '}
            <span className="truncate font-semibold text-fg">{page.title}</span>
          </p>
        ) : (
          <span />
        )}
        <a
          href="/assistant"
          aria-label={m.panel_open_full()}
          title={m.panel_open_full()}
          className="inline-flex size-(--icon-button-size) shrink-0 items-center justify-center rounded-control text-fg hover:bg-surface-hover"
        >
          <Icon name="external" size={18} />
        </a>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!state ? (
          <p className="text-body-sm text-fg-muted">{m.todo_loading()}</p>
        ) : !state.available ? (
          <p className="text-body-sm text-fg-muted">{m.assistant_unavailable()}</p>
        ) : (
          <PanelThread
            key={question?.at ?? 0}
            page={page}
            question={question?.text ?? null}
            payers={state.payers}
          />
        )}
      </div>
    </div>
  );
}
