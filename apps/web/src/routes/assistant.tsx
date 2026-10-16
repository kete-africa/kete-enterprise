import { CanvasIcon } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ChatCanvas } from '@/lib/chat/canvas';
import { PayWith, rememberedPayer } from '@/lib/chat/pay-with';
import { refusal } from '@/lib/forms';
import { CenterIntelligence } from '@/lib/intelligence';
import { keepConversationAsSkill } from '@/lib/skills';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchKeteThread, fetchThread } from '@/lib/threads';
import { fetchAssistant, fetchConversation, fetchConversations, type Payer } from '@/lib/workspace';
import { PinToSidebar } from '@/lib/sidebar-nav';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

const isConversation = (value: unknown): value is string =>
  typeof value === 'string' && /^cnv_[0-9a-f-]{8,64}$/.test(value);

export const Route = createFileRoute('/assistant')({
  validateSearch: (search: Record<string, unknown>): { c?: string; q?: string } => ({
    ...(isConversation(search['c']) ? { c: search['c'] } : {}),
    // A question asked from Ctrl K (spec 046), sent once the page runs.
    ...(typeof search['q'] === 'string' && search['q'].trim()
      ? { q: search['q'].slice(0, 4000) }
      : {}),
  }),
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ c: search.c }),
  loader: async ({ deps }) => {
    const [assistant, list, current, kete] = await Promise.all([
      fetchAssistant(),
      fetchConversations(),
      deps.c ? fetchConversation({ data: { conversationId: deps.c } }) : Promise.resolve(null),
      // Her thread « Kete » (D-057): what she told Kete from WhatsApp or Telegram.
      fetchKeteThread()
        .then((thread) => fetchThread({ data: { threadId: thread.id } }))
        .catch(() => null),
    ]);
    return { assistant, conversations: list.conversations, current, kete };
  },
  component: AssistantPage,
});

/** When a thread last moved: « il y a 2 min », « hier », « lun. », a date. */
function movedAt(at: string): string {
  const ms = Date.now() - Date.parse(at);
  const words = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  if (ms < 3_600_000) return words.format(-Math.max(1, Math.round(ms / 60_000)), 'minute');
  if (ms < 86_400_000) return words.format(-Math.round(ms / 3_600_000), 'hour');
  if (ms < 2 * 86_400_000) return words.format(-1, 'day');
  if (ms < 7 * 86_400_000) {
    return new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(new Date(at));
  }
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
    new Date(at),
  );
}

const threadClass =
  'block rounded-[5px] px-2.5 py-2 text-[14px] text-fg no-underline hover:bg-surface-hover aria-[current=page]:bg-surface-selected aria-[current=page]:font-semibold';
const footClass =
  'block rounded-[5px] px-2.5 py-1.5 text-left text-[13px] text-fg-soft no-underline hover:bg-surface-hover hover:text-fg';

/**
 * Her thread « Kete » (doctrine D-057, spec 090; was « Demander », spec 085): her conversations
 * and what she told Kete from her phone on the left, Kete Intelligence in the middle — the same as
 * beside every page — and the document it wrote beside it. It acts with her rights and prepares;
 * she decides.
 */
function AssistantPage() {
  const { me } = Route.useRouteContext();
  const { assistant, conversations, current, kete } = Route.useLoaderData();
  const fromPhone = (kete?.messages ?? []).slice(-3).reverse();
  const [document, setDocument] = useState<{ title: string; content: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payer, setPayer] = useState<Payer | null>(assistant.payers[0] ?? null);
  // The payer she chose last on this device, once the page runs in her browser.
  useEffect(() => setPayer(rememberedPayer(assistant.payers)), [assistant.payers]);
  const { q } = Route.useSearch();
  const [question] = useState(() => (q ? { text: q, at: Date.now() } : null));
  useEffect(() => {
    // The question from Ctrl K is asked once: the address keeps only the thread.
    if (q) {
      window.history.replaceState(
        null,
        '',
        current ? `/assistant?c=${current.conversationId}` : '/assistant',
      );
    }
  }, [q, current]);
  const firstName = me.name.split(' ')[0] ?? me.name;
  return (
    <AppShell me={me} current="assistant" bleed>
      <div
        className={`grid h-full min-h-0 ${
          document
            ? 'grid-cols-[230px_minmax(0,1fr)_minmax(0,1fr)]'
            : 'grid-cols-[270px_minmax(0,1fr)]'
        } @max-[760px]/main:grid-cols-1`}
      >
        <nav
          aria-label={m.assistant_conversations()}
          className="flex min-h-0 flex-col overflow-auto border-r border-line bg-surface px-3.5 py-4 @max-[760px]/main:hidden"
        >
          <a
            href="/assistant"
            className="inline-flex h-[33px] w-full items-center justify-center gap-[7px] rounded-[5px] border border-line-control bg-surface-control px-3 text-[14px] font-semibold text-fg no-underline hover:bg-surface-hover"
          >
            <CanvasIcon name="plus" size={16} />
            {m.intelligence_new_thread()}
          </a>
          {fromPhone.length > 0 && (
            <section aria-label={m.kete_from_phone()} className="mt-4 grid gap-1.5">
              <p className="m-0 px-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
                {m.kete_from_phone()}
              </p>
              {fromPhone.map((said) => (
                <p
                  key={said.first}
                  className="m-0 rounded-[5px] bg-surface-selected px-2.5 py-2 text-[13px]"
                >
                  <span className="line-clamp-3">{said.text}</span>
                  <small className="mt-0.5 block text-[12px] text-fg-muted">
                    {said.via === 'telegram' ? m.threads_via_telegram() : m.threads_via_whatsapp()}{' '}
                    · {movedAt(said.at)}
                  </small>
                </p>
              ))}
            </section>
          )}
          {conversations.length > 0 && (
            <>
              <p className="m-0 px-1.5 pt-5 pb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
                {m.assistant_conversations()}
              </p>
              {conversations.map((c) => (
                <a
                  key={c.conversationId}
                  href={`/assistant?c=${c.conversationId}`}
                  aria-current={c.conversationId === current?.conversationId ? 'page' : undefined}
                  className={threadClass}
                >
                  <span className="line-clamp-2">{c.title || m.intelligence_thread()}</span>
                  <small className="mt-0.5 block text-[12px] font-normal text-fg-muted">
                    {movedAt(c.updatedAt)}
                  </small>
                </a>
              ))}
            </>
          )}
          <div className="mt-auto flex flex-col border-t border-line pt-2.5">
            {current && (
              <PinToSidebar
                me={me}
                shortcut={{
                  kind: 'conversation',
                  ref: current.conversationId,
                  label: current.title.slice(0, 120) || m.nav_assistant(),
                }}
              />
            )}
            {me.modules.skills && current && (
              <button
                type="button"
                className={footClass}
                onClick={() =>
                  void keepConversationAsSkill({
                    data: { conversationId: current.conversationId },
                  }).then((answer) =>
                    setNotice(
                      answer.ok
                        ? m.skills_kept_notice({
                            name: (answer.data as { skill: { name: string } }).skill.name,
                          })
                        : refusal(answer.error),
                    ),
                  )
                }
              >
                {m.skills_keep_conversation()}
              </button>
            )}
            <a href="/assistant/memoire" className={footClass}>
              {m.memory_link()}
            </a>
            <a href="/assistant/echanges" className={footClass}>
              {m.exchanges_link()}
            </a>
            <a href="/assistant/taches" className={footClass}>
              {m.schedules_link()}
            </a>
            <a href="/assistant/connexion" className={footClass}>
              {m.assistant_connection_link()}
            </a>
            {assistant.payers.length > 1 && (
              <div className="px-2.5 pt-2">
                <PayWith payers={assistant.payers} value={payer} onChange={setPayer} />
              </div>
            )}
            {notice && (
              <p role="status" className="m-0 px-2.5 pt-2 text-[12px] text-fg-muted">
                {notice}
              </p>
            )}
          </div>
        </nav>
        <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[880px] flex-col">
          {!assistant.available ? (
            <p className="m-6 text-fg-muted">{m.assistant_unavailable()}</p>
          ) : (
            <CenterIntelligence
              key={current?.conversationId ?? 'new'}
              page={{ kind: 'place', title: m.nav_kete(), href: '/assistant' }}
              question={question}
              name={firstName}
              conversationId={current?.conversationId ?? null}
              initial={current?.messages ?? []}
              onConversation={(id) => {
                if (!current) window.history.replaceState(null, '', `/assistant?c=${id}`);
              }}
              onCanvas={setDocument}
              apps={me.apps}
              payer={payer}
            />
          )}
        </div>
        {document && (
          <div className="min-h-0 overflow-auto border-l border-line p-4">
            <ChatCanvas
              canvas={document}
              pdf={me.modules.documents}
              onClose={() => setDocument(null)}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
