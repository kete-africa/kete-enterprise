import { Button, EmptyState, PageHeader, Row, RowList } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { refusal } from '@/lib/forms';
import {
  fetchNotifications,
  readAllNotifications,
  subscribeDevice,
  unsubscribeDevice,
} from '@/lib/notifications';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/notifications')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchNotifications(),
  component: NotificationsPage,
});

/** The VAPID public key, as the browser's PushManager wants it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type Device = 'unknown' | 'unsupported' | 'denied' | 'off' | 'on';

/**
 * Her notifications (spec 030): what happened for her, read or not; and this device, told by Web
 * Push when she asks.
 */
function NotificationsPage() {
  const { me } = Route.useRouteContext();
  const { notifications, unread, pushKey } = Route.useLoaderData();
  const router = useRouter();
  const [device, setDevice] = useState<Device>('unknown');
  const [error, setError] = useState<string | null>(null);
  const when = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window))
      return setDevice('unsupported');
    if (Notification.permission === 'denied') return setDevice('denied');
    void navigator.serviceWorker.getRegistration('/sw.js').then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setDevice(sub ? 'on' : 'off');
    });
  }, []);

  const subscribe = async () => {
    setError(null);
    if (!pushKey) return setError(m.notif_push_off());
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setDevice('denied');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(pushKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const answer = await subscribeDevice({ data: json });
      if (!answer.ok) return setError(refusal(answer.error));
      setDevice('on');
    } catch {
      setError(m.error_generic());
    }
  };
  const unsubscribe = async () => {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await unsubscribeDevice({ data: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setDevice('off');
  };

  return (
    <AppShell me={me} current="notifications">
      <PageHeader
        title={m.notif_title()}
        description={m.notif_explain()}
        actions={
          unread > 0 ? (
            <Button
              variant="secondary"
              onClick={() => void readAllNotifications().then(() => router.invalidate())}
            >
              {m.notif_read_all()}
            </Button>
          ) : undefined
        }
      />
      <section className="flex flex-wrap items-center gap-3 rounded-box border border-line bg-surface p-4">
        {device === 'on' ? (
          <>
            <span>{m.notif_device_on()}</span>
            <Button variant="secondary" onClick={() => void unsubscribe()}>
              {m.notif_device_off()}
            </Button>
          </>
        ) : device === 'unsupported' ? (
          <span className="text-fg-muted">{m.notif_device_unsupported()}</span>
        ) : device === 'denied' ? (
          <span className="text-fg-muted">{m.notif_device_denied()}</span>
        ) : (
          <Button onClick={() => void subscribe()} disabled={device === 'unknown'}>
            {m.notif_device()}
          </Button>
        )}
        {error && (
          <span role="alert" className="text-state-error-fg">
            {error}
          </span>
        )}
      </section>
      {unread > 0 && (
        <p className="text-body-sm text-fg-muted">{m.notif_unread({ count: unread })}</p>
      )}
      {notifications.length === 0 ? (
        <EmptyState title={m.notif_none()} />
      ) : (
        <RowList label={m.notif_title()}>
          {notifications.map((n) => (
            <Row
              key={n.notificationId}
              title={n.read ? n.title : `• ${n.title}`}
              meta={[n.body, when(n.createdAt)].filter(Boolean).join(' · ')}
              {...(n.href ? { href: n.href } : {})}
            />
          ))}
        </RowList>
      )}
    </AppShell>
  );
}
