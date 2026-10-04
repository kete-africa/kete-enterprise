/* global self */
/* Kete Enterprise's service worker (spec 030): it shows a notification sent by Web Push, and opens
   its page when the person taps it. It caches nothing. */
self.addEventListener('push', (event) => {
  let message = { title: 'Kete Enterprise', body: '', href: '/notifications', tag: undefined };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    /* A push without a readable body still shows the product's name. */
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      data: { href: message.href },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || '/notifications';
  event.waitUntil(self.clients.openWindow(href));
});
