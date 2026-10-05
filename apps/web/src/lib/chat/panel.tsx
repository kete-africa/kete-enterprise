import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { Icon, IconButton } from '@kete/design';
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
 * The panel at the right of every screen (spec 048). A new question — from Ctrl K — starts a new
 * conversation; closing it keeps nothing but the conversation, found again in the assistant.
 */
export function AssistantPanel({
  open,
  onClose,
  page,
  question,
}: {
  open: boolean;
  onClose: () => void;
  page: AssistantPage | null;
  question: { text: string; at: number } | null;
}) {
  const [state, setState] = useState<{ available: boolean; payers: Payer[] } | null>(null);
  useEffect(() => {
    if (!open || state) return;
    void fetchAssistant()
      .then((a) => setState({ available: a.available, payers: a.payers }))
      .catch(() => setState({ available: false, payers: [] }));
  }, [open, state]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside
      aria-label={m.nav_assistant()}
      className="fixed inset-y-0 right-0 z-20 flex w-[400px] max-w-full flex-col border-l border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] shadow-[-8px_0_24px_#0003] max-[760px]:w-full"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Icon name="sparkle" size={18} />
          {m.nav_assistant()}
        </p>
        <div className="flex gap-1">
          <a
            href="/assistant"
            aria-label={m.panel_open_full()}
            title={m.panel_open_full()}
            className="inline-flex size-(--icon-button-size) items-center justify-center rounded-control text-fg hover:bg-surface-hover"
          >
            <Icon name="external" size={18} />
          </a>
          <IconButton label={m.panel_close()} onClick={onClose}>
            <Icon name="close" size={18} />
          </IconButton>
        </div>
      </header>
      {page && (
        <p className="mb-2 flex items-center gap-1.5 text-body-sm text-fg-muted">
          <Icon name="search" size={14} />
          {m.panel_seeing_short()}{' '}
          <span className="truncate font-semibold text-fg">{page.title}</span>
        </p>
      )}
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
    </aside>
  );
}
