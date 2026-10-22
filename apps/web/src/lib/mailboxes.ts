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
      kind: (v.kind === 'shared' ? 'shared' : 'personal') as 'personal' | 'shared',
      label: text(v.label, 120),
      readSent: v.readSent !== false,
    };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ connected: string }>> => {
    const { name, label, ...rest } = data;
    return sendGesture(
      getRequest(),
      '/v1/threads/mailboxes',
      { ...rest, ...(name ? { name } : {}), ...(label ? { label } : {}) },
      crypto.randomUUID(),
    );
  });

// --- Mail as decided (spec 099, FR-018) --------------------------------------------------------------

export type RoutingStep = 'reply' | 'address' | 'contact' | 'model' | 'classify';

export interface MailOverview {
  mailboxes: {
    userId: string;
    address: string;
    kind: 'personal' | 'shared';
    label: string | null;
    readSent: boolean;
    sentFolder: string;
    keteFolder: string;
    active: boolean;
    week: number;
  }[];
  steps: Record<RoutingStep, number>;
  /** The threads' own domain: none chosen yet. */
  domain: string | null;
  live: { whatsapp: boolean; telegram: boolean; form: boolean };
}

/** What Kete reads in each box and how it ranged this week. */
export const fetchMailOverview = createServerFn({ method: 'GET' }).handler(() =>
  callApi<MailOverview>(getRequest(), '/v1/threads/mailboxes/overview'),
);

/** A box shared and read whole, or personal and read by the three rules; its Sent folder too. */
export const saveMailRules = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      userId: text(v.userId, 80),
      kind: (v.kind === 'shared' ? 'shared' : 'personal') as 'personal' | 'shared',
      label: text(v.label, 120),
      readSent: v.readSent === true,
      sentFolder: text(v.sentFolder, 200) || 'Sent',
      keteFolder: text(v.keteFolder, 200) || 'Kete',
    };
  })
  .handler(({ data }): Promise<GestureAnswer<{ rules: object }>> => {
    const { userId, ...rules } = data;
    return sendGesture(
      getRequest(),
      `/v1/threads/mailboxes/${encodeURIComponent(userId)}/rules`,
      rules,
      crypto.randomUUID(),
    );
  });
