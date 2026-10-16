import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';

// The mailboxes the center reads (spec 089, FR-004): a person's IMAP and SMTP, connected by an
// administrator; the password is sealed by the API and never comes back.

export interface MailboxRow {
  userId: string;
  address: string;
  imapHost: string;
  smtpHost: string;
  active: boolean;
  updatedAt: string;
}

export const fetchMailboxes = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ mailboxes: MailboxRow[] }>(getRequest(), '/v1/threads/mailboxes').then(
    (a) => a.mailboxes,
  ),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const port = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};

export const connectMailbox = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      userId: text(v.userId, 80),
      address: text(v.address, 320),
      name: text(v.name, 120),
      imapHost: text(v.imapHost, 200),
      imapPort: port(v.imapPort, 993),
      smtpHost: text(v.smtpHost, 200),
      smtpPort: port(v.smtpPort, 465),
      login: text(v.login, 320),
      password: typeof v.password === 'string' ? v.password.slice(0, 500) : '',
    };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ connected: string }>> => {
    const { name, ...rest } = data;
    return sendGesture(
      getRequest(),
      '/v1/threads/mailboxes',
      { ...rest, ...(name ? { name } : {}) },
      crypto.randomUUID(),
    );
  });
