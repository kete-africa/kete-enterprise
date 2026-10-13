import { Button, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { changePhone, fetchPhone, type PhoneChange } from '@/lib/phone';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/mon-telephone')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchPhone(),
  component: PhonePage,
});

/**
 * « Mon téléphone » (spec 077): what waits for her decision arrives on her WhatsApp or her
 * Telegram, with « Approuver » and « Refuser »; her tap decides, as on her Inbox. She ties it and
 * unties it herself; nothing reaches a phone she did not tie.
 */
function PhonePage() {
  const { me } = Route.useRouteContext();
  const phone = Route.useLoaderData();
  const router = useRouter();
  const [number, setNumber] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [sender, setSender] = useState({
    phoneNumberId: '',
    accessToken: '',
    appSecret: '',
    botToken: '',
    webhookSecret: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const change = (input: PhoneChange, then?: (data: unknown) => void) => {
    setError(null);
    setDone(null);
    void changePhone({ data: input }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      then?.(answer.data);
      await router.invalidate();
    });
  };
  const can = (channel: 'whatsapp' | 'telegram') => phone.senders.includes(channel);

  return (
    <AppShell me={me} current="phone">
      <PageHeader title={m.nav_phone()} description={m.phone_explain()} />
      <PageSection title={m.phone_mine()}>
        <div className="flex flex-col gap-3">
          <p>
            {phone.tied ? (
              <Tag tone="validated">
                {m.phone_tied({ channel: phone.channel === 'telegram' ? 'Telegram' : 'WhatsApp' })}
              </Tag>
            ) : (
              <Tag tone="neutral">{m.phone_untied()}</Tag>
            )}
          </p>
          {phone.senders.length === 0 && <p className="text-fg-muted">{m.phone_no_sender()}</p>}
          {can('whatsapp') && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                change({ kind: 'tie', channel: 'whatsapp', phone: number }, () => setNumber(''));
              }}
            >
              <TextField
                label={m.phone_whatsapp_number()}
                hint={m.phone_whatsapp_hint()}
                value={number}
                inputMode="tel"
                onChange={(event) => setNumber(event.target.value)}
              />
              <Button type="submit" disabled={number.trim().length < 8}>
                {m.phone_tie_whatsapp()}
              </Button>
            </form>
          )}
          {can('telegram') && (
            <div className="flex flex-col gap-2">
              <div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    change({ kind: 'tie', channel: 'telegram' }, (data) =>
                      setCode((data as { link: string | null }).link),
                    )
                  }
                >
                  {m.phone_tie_telegram()}
                </Button>
              </div>
              {code && <p>{m.phone_telegram_code({ code })}</p>}
            </div>
          )}
          {phone.tied && (
            <div>
              <Button variant="secondary" onClick={() => change({ kind: 'untie' })}>
                {m.phone_untie()}
              </Button>
            </div>
          )}
        </div>
      </PageSection>

      {me.administrator && (
        <PageSection title={m.phone_senders()}>
          <div className="flex flex-col gap-4">
            <p className="text-fg-muted">{m.phone_senders_explain()}</p>
            <form
              className="grid items-end gap-3 sm:grid-cols-4"
              onSubmit={(event) => {
                event.preventDefault();
                change(
                  {
                    kind: 'sender',
                    channel: 'whatsapp',
                    phoneNumberId: sender.phoneNumberId,
                    accessToken: sender.accessToken,
                    appSecret: sender.appSecret,
                  },
                  () => setDone(m.phone_sender_connected()),
                );
              }}
            >
              <TextField
                label={m.phone_number_id()}
                value={sender.phoneNumberId}
                onChange={(e) => setSender({ ...sender, phoneNumberId: e.target.value })}
              />
              <TextField
                label={m.phone_access_token()}
                type="password"
                value={sender.accessToken}
                onChange={(e) => setSender({ ...sender, accessToken: e.target.value })}
              />
              <TextField
                label={m.phone_app_secret()}
                type="password"
                value={sender.appSecret}
                onChange={(e) => setSender({ ...sender, appSecret: e.target.value })}
              />
              <Button
                type="submit"
                disabled={!sender.phoneNumberId || !sender.accessToken || !sender.appSecret}
              >
                {m.phone_connect_whatsapp()}
              </Button>
            </form>
            <form
              className="grid items-end gap-3 sm:grid-cols-4"
              onSubmit={(event) => {
                event.preventDefault();
                change(
                  {
                    kind: 'sender',
                    channel: 'telegram',
                    botToken: sender.botToken,
                    webhookSecret: sender.webhookSecret,
                  },
                  () => setDone(m.phone_sender_connected()),
                );
              }}
            >
              <TextField
                label={m.phone_bot_token()}
                type="password"
                value={sender.botToken}
                onChange={(e) => setSender({ ...sender, botToken: e.target.value })}
              />
              <TextField
                label={m.phone_webhook_secret()}
                type="password"
                value={sender.webhookSecret}
                onChange={(e) => setSender({ ...sender, webhookSecret: e.target.value })}
              />
              <span />
              <Button type="submit" disabled={!sender.botToken || !sender.webhookSecret}>
                {m.phone_connect_telegram()}
              </Button>
            </form>
          </div>
        </PageSection>
      )}
      {done && <p role="status">{done}</p>}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </AppShell>
  );
}
