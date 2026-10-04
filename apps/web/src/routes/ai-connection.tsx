import { Button, CopyButton, Facts, PageHeader, Panel, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  checkSubscription,
  fetchConnection,
  providers,
  removeConnection,
  removeSubscription,
  saveConnection,
  startSubscription,
  type ConnectionScreen,
  type Provider,
} from '@/lib/ai';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/assistant/connexion')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchConnection(),
  component: ConnectionPage,
});

const providerName: Record<Provider, () => string> = {
  openai: m.ai_provider_openai,
  anthropic: m.ai_provider_anthropic,
  mistral: m.ai_provider_mistral,
  deepseek: m.ai_provider_deepseek,
};

/**
 * Her own AI connection (specs 026, 026b): her assistant and her agents run on her own tokens, when
 * the organization allows it. She brings her key in a dialog; it is tried, kept sealed, never
 * shown. Or she connects the subscription she already pays for, on a machine of her own.
 */
function ConnectionPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState({ provider: 'openai' as Provider, model: '', apiKey: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const done = async (answer: { ok: boolean; error: string | null }) => {
    setNotice(
      answer.ok
        ? { ok: true, text: m.ai_connection_done() }
        : { ok: false, text: refusal(answer.error) },
    );
    setDraft({ ...draft, apiKey: '' });
    await router.invalidate();
  };
  const open = screen.available && screen.policy !== 'off';
  const c = screen.connection;
  return (
    <AppShell me={me} current="assistant">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_assistant(), href: '/assistant' }]}
        title={m.ai_connection_title()}
        description={m.ai_connection_explain()}
        actions={
          open ? (
            <>
              <DialogForm
                title={c ? m.ai_connection_change() : m.ai_connection_add()}
                trigger="primary"
                busy={busy}
                ready={draft.model.trim() !== '' && draft.apiKey.trim().length >= 20}
                onSubmit={() => {
                  setBusy(true);
                  setNotice(null);
                  void saveConnection({ data: draft })
                    .then(done)
                    .catch(() => setNotice({ ok: false, text: m.error_generic() }))
                    .finally(() => setBusy(false));
                }}
              >
                <Select
                  label={m.ai_connection_provider()}
                  value={draft.provider}
                  onChange={(e) => setDraft({ ...draft, provider: e.target.value as Provider })}
                >
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {providerName[p]()}
                    </option>
                  ))}
                </Select>
                <TextField
                  label={m.ai_connection_model()}
                  hint={m.ai_connection_model_hint()}
                  value={draft.model}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
                <TextField
                  label={m.ai_connection_key()}
                  hint={m.ai_connection_key_hint()}
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  maxLength={400}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </DialogForm>
              {c && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void removeConnection()
                      .then(done)
                      .finally(() => setBusy(false));
                  }}
                >
                  {m.ai_connection_remove()}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`text-body-sm ${notice.ok ? 'text-fg-muted' : 'text-state-error-fg'}`}
        >
          {notice.text}
        </p>
      )}
      <Panel>
        <p className="mb-3">
          {screen.policy === 'off'
            ? m.ai_policy_off_person()
            : screen.policy === 'required'
              ? m.ai_policy_required_person()
              : m.ai_policy_allowed_person()}
        </p>
        {!screen.available && (
          <p className="mb-3 text-body-sm text-state-verify-fg">{m.ai_connection_unavailable()}</p>
        )}
        {c ? (
          <Facts
            items={[
              { label: m.ai_connection_provider(), value: providerName[c.provider]() },
              { label: m.ai_connection_model(), value: c.model },
              { label: m.ai_connection_key(), value: `•••• ${c.keyEnd}` },
              { label: m.ai_connection_since(), value: c.createdAt.slice(0, 10) },
              {
                label: m.ai_connection_last_used(),
                value: c.lastUsedAt ? c.lastUsedAt.slice(0, 16).replace('T', ' ') : '—',
              },
            ]}
          />
        ) : (
          <p className="text-body-sm text-fg-muted">{m.ai_connection_none()}</p>
        )}
      </Panel>
      {screen.policy !== 'off' && <SubscriptionPanel screen={screen} />}
    </AppShell>
  );
}

/**
 * Her own subscription (spec 026b): she opens the sign-in page, enters the code given here, then
 * says she is done; Kete Enterprise checks it on her machine. Removing it deletes her machine.
 */
function SubscriptionPanel({ screen }: { screen: ConnectionScreen }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState<{ url: string; code: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const s = screen.subscription;
  const failed = (error: string | null) => setNotice({ ok: false, text: refusal(error) });
  const run = (gesture: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    void gesture()
      .catch(() => failed(null))
      .finally(() => setBusy(false));
  };
  const start = () =>
    run(async () => {
      const answer = await startSubscription();
      if (answer.ok) setSignIn({ url: answer.url, code: answer.code });
      else failed(answer.error);
      await router.invalidate();
    });
  const check = () =>
    run(async () => {
      const answer = await checkSubscription();
      if (!answer.ok) failed(answer.error);
      else if (answer.subscription?.state === 'connected') {
        setSignIn(null);
        setNotice({ ok: true, text: m.ai_connection_done() });
      } else setNotice({ ok: false, text: m.ai_subscription_waiting() });
      await router.invalidate();
    });
  const remove = () =>
    run(async () => {
      const answer = await removeSubscription();
      if (!answer.ok) failed(answer.error);
      setSignIn(null);
      await router.invalidate();
    });
  return (
    <Panel>
      <h2 className="mb-2 font-heading text-title font-semibold">{m.ai_subscription_title()}</h2>
      <p className="mb-3">{m.ai_subscription_explain()}</p>
      {!screen.subscriptionsAvailable ? (
        <p className="text-body-sm text-state-verify-fg">{m.ai_subscription_unavailable()}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {s?.state === 'connected' ? (
            <Facts
              items={[
                { label: m.ai_subscription_state(), value: m.ai_subscription_connected() },
                { label: m.ai_subscription_since(), value: (s.connectedAt ?? '').slice(0, 10) },
                {
                  label: m.ai_connection_last_used(),
                  value: s.lastUsedAt ? s.lastUsedAt.slice(0, 16).replace('T', ' ') : '—',
                },
              ]}
            />
          ) : s?.state === 'signing_in' && !signIn ? (
            <p className="text-body-sm text-fg-muted">{m.ai_subscription_signing_in()}</p>
          ) : !s ? (
            <p className="text-body-sm text-fg-muted">{m.ai_subscription_none()}</p>
          ) : null}
          {signIn && (
            <div className="flex flex-col gap-2 rounded-box border border-line p-4">
              <p className="text-body-sm">{m.ai_subscription_step()}</p>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-label={m.ai_subscription_code()}
                  className="font-number text-title font-semibold tracking-widest"
                >
                  {signIn.code}
                </span>
                <CopyButton
                  text={signIn.code}
                  label={m.ai_subscription_code()}
                  copiedLabel={m.ai_subscription_copied()}
                />
                <a
                  href={signIn.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
                >
                  {m.ai_subscription_open()}
                </a>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {s?.state === 'signing_in' && (
              <Button disabled={busy} onClick={check}>
                {m.ai_subscription_check()}
              </Button>
            )}
            {s?.state !== 'connected' && (
              <Button variant={s ? 'secondary' : 'primary'} disabled={busy} onClick={start}>
                {s ? m.ai_subscription_restart() : m.ai_subscription_connect()}
              </Button>
            )}
            {s && (
              <Button variant="secondary" disabled={busy} onClick={remove}>
                {m.ai_subscription_remove()}
              </Button>
            )}
          </div>
          {notice && (
            <p
              role={notice.ok ? 'status' : 'alert'}
              className={`text-body-sm ${notice.ok ? 'text-fg-muted' : 'text-state-error-fg'}`}
            >
              {notice.text}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
