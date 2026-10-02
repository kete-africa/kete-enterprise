import { Button, PageSection, PageTitle, Panel, Tag } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchOutbox, fetchOutboxMessage } from '@/lib/admin';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/administration/boite-de-test')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchOutbox(),
  component: OutboxPage,
});

/**
 * The test outbox (spec 010): every e-mail that would have left, read as its recipient would — its
 * links work. In send mode nothing stays here.
 */
function OutboxPage() {
  const { me } = Route.useRouteContext();
  const outbox = Route.useLoaderData();
  const [open, setOpen] = useState<{ messageId: string; subject: string; html: string } | null>(
    null,
  );
  const format = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' });
  return (
    <AppShell me={me} current="outbox">
      <PageTitle>{m.nav_outbox()}</PageTitle>
      <p className="text-fg-muted">
        {outbox.mode === 'capture' ? m.outbox_capture() : m.outbox_send()}
      </p>
      <PageSection first>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Panel title={m.outbox_messages({ count: String(outbox.messages.length) })}>
            {outbox.messages.length === 0 ? (
              <p className="text-fg-muted">{m.outbox_empty()}</p>
            ) : (
              <ul className="grid gap-1">
                {outbox.messages.map((message) => (
                  <li key={message.messageId}>
                    <button
                      type="button"
                      className="w-full rounded-control px-2 py-2 text-left hover:bg-surface-hover"
                      onClick={() => {
                        void fetchOutboxMessage({ data: { messageId: message.messageId } }).then(
                          (full) =>
                            setOpen({
                              messageId: message.messageId,
                              subject: full.subject,
                              html: full.html,
                            }),
                        );
                      }}
                    >
                      <span className="block font-semibold">{message.subject}</span>
                      <span className="flex flex-wrap gap-2 text-body-sm text-fg-muted">
                        <span>{message.recipient}</span>
                        <span className="font-number">
                          {format.format(new Date(message.createdAt))}
                        </span>
                        <Tag>{message.purpose}</Tag>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {open && (
            <Panel title={open.subject}>
              {/* The e-mail as its recipient sees it: in a sandbox, its links open a new tab. */}
              <iframe
                title={open.subject}
                className="h-[640px] w-full rounded-control border border-line bg-white"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={open.html.replace('<html>', '<html><head><base target="_blank"></head>')}
              />
              <div className="mt-3">
                <Button variant="secondary" onClick={() => setOpen(null)}>
                  {m.outbox_close()}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </PageSection>
    </AppShell>
  );
}
