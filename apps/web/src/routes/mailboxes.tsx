import { Button, CanvasIcon, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { refusal } from '@/lib/forms';
import {
  connectMailbox,
  fetchMailOverview,
  saveMailRules,
  type MailOverview,
  type RoutingStep,
} from '@/lib/mailboxes';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchChart } from '@/lib/structure';
import { fetchThreads, importIntoThread } from '@/lib/threads';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/boites-mail')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: async () => {
    const [overview, chart, { threads }] = await Promise.all([
      fetchMailOverview(),
      fetchChart({ data: {} }),
      fetchThreads(),
    ]);
    return {
      overview,
      threads: threads.filter((t) => t.thread.state === 'open'),
      people: chart.people
        .filter((p) => p.accountUserId)
        .map((p) => ({ userId: p.accountUserId as string, name: p.name, email: p.email })),
    };
  },
  component: MailboxesPage,
});

const steps: { key: RoutingStep; title: () => string; hint: () => string }[] = [
  { key: 'reply', title: m.mail_step_reply, hint: m.mail_step_reply_hint },
  { key: 'address', title: m.mail_step_address, hint: m.mail_step_address_hint },
  { key: 'contact', title: m.mail_step_contact, hint: m.mail_step_contact_hint },
  { key: 'model', title: m.mail_step_model, hint: m.mail_step_model_hint },
  { key: 'classify', title: m.mail_step_classify, hint: m.mail_step_classify_hint },
];

const fieldClass =
  'h-(--control-height) rounded-control border border-line-control bg-control px-2 font-normal';

/** What Kete reads in one box: shared and whole, or personal by the three rules; its Sent too. */
function BoxRules({ box }: { box: MailOverview['mailboxes'][number] }) {
  const router = useRouter();
  const [rules, setRules] = useState({
    kind: box.kind,
    label: box.label ?? '',
    readSent: box.readSent,
    sentFolder: box.sentFolder,
    keteFolder: box.keteFolder,
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2 border-t border-line bg-bg px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void saveMailRules({ data: { userId: box.userId, ...rules } }).then(async (answer) => {
          if (!answer.ok) return setError(refusal(answer.error));
          await router.invalidate();
        });
      }}
    >
      <fieldset className="flex flex-wrap gap-3 text-body-sm">
        <legend className="mb-1 font-semibold">{m.mail_kind()}</legend>
        {(['shared', 'personal'] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`kind-${box.userId}`}
              checked={rules.kind === kind}
              onChange={() => setRules({ ...rules, kind })}
            />
            {kind === 'shared' ? m.mail_kind_shared() : m.mail_kind_personal()}
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1 text-body-sm font-semibold">
        {m.mail_label()}
        <input
          value={rules.label}
          onChange={(event) => setRules({ ...rules, label: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="flex items-center gap-2 text-body-sm">
        <input
          type="checkbox"
          checked={rules.readSent}
          onChange={(event) => setRules({ ...rules, readSent: event.target.checked })}
        />
        {m.mail_read_sent()}
      </label>
      <div className="grid grid-cols-2 gap-2 max-[640px]:grid-cols-1">
        <label className="grid gap-1 text-body-sm font-semibold">
          {m.mail_sent_folder()}
          <input
            value={rules.sentFolder}
            onChange={(event) => setRules({ ...rules, sentFolder: event.target.value })}
            className={fieldClass}
          />
        </label>
        {rules.kind === 'personal' && (
          <label className="grid gap-1 text-body-sm font-semibold">
            {m.mail_kete_folder()}
            <input
              value={rules.keteFolder}
              onChange={(event) => setRules({ ...rules, keteFolder: event.target.value })}
              className={fieldClass}
            />
          </label>
        )}
      </div>
      <div>
        <Button type="submit">{m.mail_save()}</Button>
      </div>
      {error && <p className="text-body-sm text-state-error-fg">{error}</p>}
    </form>
  );
}

/** A conversation from elsewhere, into one of the threads: once per message (FR-019). */
function ImportInto({ threads }: { threads: { id: string; title: string }[] }) {
  const picker = useRef<HTMLInputElement>(null);
  const [threadId, setThreadId] = useState(threads[0]?.id ?? '');
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <input
        ref={picker}
        type="file"
        hidden
        accept=".txt,.json,.eml,text/plain,application/json,message/rfc822"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || !threadId) return;
          const kind = file.name.endsWith('.json')
            ? 'telegram'
            : file.name.endsWith('.eml')
              ? 'eml'
              : 'whatsapp';
          const reader = new FileReader();
          reader.onload = () => {
            const data = String(reader.result).split(',')[1] ?? '';
            void importIntoThread({ data: { threadId, kind, data } }).then((answer) =>
              setNote(
                answer.ok
                  ? m.threads_imported_done({
                      imported: String(answer.data.imported),
                      skipped: String(answer.data.skipped),
                      recognized: String(answer.data.recognized),
                    })
                  : refusal(answer.error),
              ),
            );
          };
          reader.readAsDataURL(file);
        }}
      />
      <span className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-body-sm font-semibold">
          {m.mail_import_into()}
          <select
            value={threadId}
            onChange={(event) => setThreadId(event.target.value)}
            className={fieldClass}
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" disabled={!threadId} onClick={() => picker.current?.click()}>
          <CanvasIcon name="import" size={14} />
          {m.mail_import_drop()}
        </Button>
      </span>
      <p className="m-0 text-body-sm text-fg-muted">{m.mail_import_hint()}</p>
      <p className="m-0 text-body-sm text-fg-muted">{m.mail_import_why()}</p>
      {note && <p className="m-0 text-body-sm">{note}</p>}
    </div>
  );
}

/**
 * « Mails et conversations » (spec 099, FR-018; canvas v6.2): what Kete reads in each box — a
 * shared one whole, a personal one by the three rules, its Sent folder by the same —, how each
 * mail found its thread this week, the conversations imported, the threads' domain, the channels
 * heard live. Connecting a box keeps its password sealed (spec 089, FR-004).
 */
function MailboxesPage() {
  const { me } = Route.useRouteContext();
  const { overview, people, threads } = Route.useLoaderData();
  const router = useRouter();
  const [connecting, setConnecting] = useState(overview.mailboxes.length === 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    userId: '',
    address: '',
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '465',
    login: '',
    password: '',
    kind: 'personal' as 'personal' | 'shared',
    label: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: Exclude<keyof typeof form, 'kind'>) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  const nameOf = (userId: string) => people.find((p) => p.userId === userId)?.name ?? userId;
  return (
    <AppShell me={me} current="mailboxes">
      <PageHeader
        title={m.mail_title()}
        description={m.mail_subtitle()}
        actions={
          <Button variant="secondary" onClick={() => setConnecting((c) => !c)}>
            <CanvasIcon name="plus" size={14} />
            {m.mail_connect()}
          </Button>
        }
      />
      <PageSection first title={m.mail_boxes()}>
        {overview.mailboxes.length === 0 ? (
          <p className="text-fg-muted">{m.mail_none()}</p>
        ) : (
          <div className="overflow-hidden rounded-box border border-line bg-surface">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_90px_auto] gap-3 border-b border-line px-4 py-2 text-[11px] font-semibold tracking-wide text-fg-muted uppercase max-[720px]:hidden">
              <span>{m.mail_box()}</span>
              <span>{m.mail_reads()}</span>
              <span>{m.mail_week()}</span>
              <span />
            </div>
            {overview.mailboxes.map((box) => (
              <div key={box.userId} className="border-b border-line last:border-b-0">
                <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_90px_auto] items-center gap-3 px-4 py-3 max-[720px]:grid-cols-1">
                  <span className="grid min-w-0">
                    <span className="truncate font-mono text-body-sm font-semibold">
                      {box.address}
                    </span>
                    <span className="text-body-sm text-fg-muted">
                      {box.kind === 'shared' ? m.mail_shared() : m.mail_personal()}
                      {' · '}
                      {box.label ?? nameOf(box.userId)}
                    </span>
                  </span>
                  <span className="text-body-sm">
                    {box.kind === 'shared' ? m.mail_reads_all() : m.mail_reads_rules()}
                    {' · '}
                    {box.readSent ? m.mail_sent_too() : m.mail_sent_not()}
                  </span>
                  <span className="font-mono text-body tabular-nums">{box.week}</span>
                  <Button
                    variant="ghost"
                    aria-expanded={editing === box.userId}
                    onClick={() => setEditing((e) => (e === box.userId ? null : box.userId))}
                  >
                    {m.mail_edit()}
                  </Button>
                </div>
                {editing === box.userId && <BoxRules box={box} />}
              </div>
            ))}
          </div>
        )}
        {connecting && (
          <form
            className="mt-3 grid max-w-2xl gap-3 rounded-box border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              void connectMailbox({
                data: { ...form, name: nameOf(form.userId), readSent: true },
              })
                .then(async (answer) => {
                  if (!answer.ok) return setError(refusal(answer.error));
                  setForm({ ...form, password: '' });
                  setConnecting(false);
                  await router.invalidate();
                })
                .finally(() => setBusy(false));
            }}
          >
            <label htmlFor="mailbox-person" className="grid gap-1 text-body-sm font-semibold">
              {m.mailboxes_person()}
              <select id="mailbox-person" {...field('userId')} className={fieldClass}>
                <option value="">{m.mailboxes_choose()}</option>
                {people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-wrap gap-3 text-body-sm">
              <legend className="mb-1 font-semibold">{m.mail_kind()}</legend>
              {(['personal', 'shared'] as const).map((kind) => (
                <label key={kind} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="kind-new"
                    checked={form.kind === kind}
                    onChange={() => setForm({ ...form, kind })}
                  />
                  {kind === 'shared' ? m.mail_kind_shared() : m.mail_kind_personal()}
                </label>
              ))}
            </fieldset>
            <TextField
              id="mailbox-address"
              label={m.mailboxes_address()}
              type="email"
              {...field('address')}
            />
            {form.kind === 'shared' && (
              <TextField id="mailbox-label" label={m.mail_label()} {...field('label')} />
            )}
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
        )}
      </PageSection>
      <PageSection title={m.mail_personal_title()}>
        <ul className="m-0 grid list-none gap-2 p-0 text-body">
          {[m.mail_rule_contact(), m.mail_rule_folder(), m.mail_rule_address()].map((rule) => (
            <li key={rule} className="flex items-start gap-2">
              <span className="mt-0.5 text-state-success-fg">
                <CanvasIcon name="ok" size={15} />
              </span>
              {rule}
            </li>
          ))}
          <li className="flex items-start gap-2 text-fg-muted">
            <span className="mt-0.5">
              <CanvasIcon name="x" size={15} />
            </span>
            {m.mail_rule_never()}
          </li>
        </ul>
      </PageSection>
      <PageSection title={`${m.mail_steps()} · ${m.mail_steps_week()}`}>
        <ol className="m-0 grid list-none overflow-hidden rounded-box border border-line bg-surface p-0">
          {steps.map((step, index) => {
            const waits = step.key === 'address' && !overview.domain;
            return (
              <li
                key={step.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <span className="grid">
                  <span className="font-semibold">
                    {index + 1} · {step.title()}
                  </span>
                  <span className="text-body-sm text-fg-muted">
                    {waits ? m.mail_step_address_wait() : step.hint()}
                  </span>
                </span>
                <span className="font-mono text-[18px] tabular-nums">
                  {waits ? '—' : overview.steps[step.key]}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-body-sm text-fg-muted">{m.mail_in_thread_text()}</p>
      </PageSection>
      <PageSection title={m.mail_import()}>
        <ImportInto threads={threads.map((t) => ({ id: t.thread.id, title: t.thread.title }))} />
      </PageSection>
      <PageSection title={m.mail_domain()}>
        {overview.domain ? (
          <p className="m-0">{m.mail_domain_set({ domain: overview.domain })}</p>
        ) : (
          <div className="grid gap-1">
            <p className="m-0 flex flex-wrap items-center gap-2">
              {m.mail_domain_open()}
              <Tag tone="verify">{m.mail_domain_yours()}</Tag>
            </p>
            <p className="m-0 text-body-sm text-fg-muted">{m.mail_domain_open_hint()}</p>
          </div>
        )}
      </PageSection>
      <PageSection title={m.mail_live()}>
        <ul className="m-0 grid list-none gap-2 p-0">
          {(
            [
              ['whatsapp', m.mail_live_whatsapp()],
              ['telegram', m.mail_live_telegram()],
              ['form', m.mail_live_form()],
            ] as const
          ).map(([key, label]) => (
            <li key={key} className="flex items-center gap-2">
              <span className="min-w-40">{label}</span>
              <Tag tone={overview.live[key] ? 'validated' : 'neutral'}>
                {overview.live[key] ? m.mail_live_on() : m.mail_live_off()}
              </Tag>
            </li>
          ))}
        </ul>
      </PageSection>
    </AppShell>
  );
}
