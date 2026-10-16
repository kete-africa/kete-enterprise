import { Button, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { connectMailbox, fetchMailboxes } from '@/lib/mailboxes';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchChart } from '@/lib/structure';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/boites-mail')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: async () => {
    const [mailboxes, chart] = await Promise.all([fetchMailboxes(), fetchChart({ data: {} })]);
    return {
      mailboxes,
      people: chart.people
        .filter((p) => p.accountUserId)
        .map((p) => ({ userId: p.accountUserId as string, name: p.name, email: p.email })),
    };
  },
  component: MailboxesPage,
});

/**
 * The mailboxes the center reads (spec 089, FR-004; doctrine D-057): the mail a person receives
 * lands in its object's thread, her answer leaves from her own box. Her password is sealed.
 */
function MailboxesPage() {
  const { me } = Route.useRouteContext();
  const { mailboxes, people } = Route.useLoaderData();
  const router = useRouter();
  const [form, setForm] = useState({
    userId: '',
    address: '',
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '465',
    login: '',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  const nameOf = (userId: string) => people.find((p) => p.userId === userId)?.name ?? userId;
  return (
    <AppShell me={me} current="mailboxes">
      <PageHeader title={m.nav_mailboxes()} description={m.mailboxes_subtitle()} />
      <PageSection first title={m.mailboxes_list({ count: String(mailboxes.length) })}>
        {mailboxes.length === 0 ? (
          <p className="text-fg-muted">{m.mailboxes_none()}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
            {mailboxes.map((box) => (
              <li key={box.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="font-semibold">{nameOf(box.userId)}</span>
                <span className="font-mono text-body-sm">{box.address}</span>
                <span className="text-body-sm text-fg-muted">
                  {m.mailboxes_servers({ imap: box.imapHost, smtp: box.smtpHost })}
                </span>
                <Tag tone={box.active ? 'validated' : 'neutral'}>
                  {box.active ? m.mailboxes_read() : m.mailboxes_paused()}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.mailboxes_connect()}>
        <form
          className="grid max-w-2xl gap-3 rounded-box border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void connectMailbox({ data: { ...form, name: nameOf(form.userId) } })
              .then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                setForm({ ...form, password: '' });
                await router.invalidate();
              })
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor="mailbox-person" className="grid gap-1 text-body-sm font-semibold">
            {m.mailboxes_person()}
            <select
              id="mailbox-person"
              {...field('userId')}
              className="h-(--control-height) rounded-control border border-line-control bg-control px-2 font-normal"
            >
              <option value="">{m.mailboxes_choose()}</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <TextField
            id="mailbox-address"
            label={m.mailboxes_address()}
            type="email"
            {...field('address')}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
            <TextField
              id="mailbox-imap"
              label={m.mailboxes_imap()}
              placeholder={m.mailboxes_host_hint()}
              {...field('imapHost')}
            />
            <TextField
              id="mailbox-imap-port"
              label={m.mailboxes_port()}
              inputMode="numeric"
              {...field('imapPort')}
            />
            <TextField
              id="mailbox-smtp"
              label={m.mailboxes_smtp()}
              placeholder={m.mailboxes_host_hint()}
              {...field('smtpHost')}
            />
            <TextField
              id="mailbox-smtp-port"
              label={m.mailboxes_port()}
              inputMode="numeric"
              {...field('smtpPort')}
            />
          </div>
          <TextField
            id="mailbox-login"
            label={m.mailboxes_login()}
            autoComplete="off"
            {...field('login')}
          />
          <TextField
            id="mailbox-password"
            label={m.mailboxes_password()}
            hint={m.mailboxes_password_hint()}
            type="password"
            autoComplete="new-password"
            {...field('password')}
          />
          <div>
            <Button type="submit" disabled={busy || !form.userId || !form.password}>
              {m.mailboxes_connect_button()}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </form>
      </PageSection>
    </AppShell>
  );
}
