import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// « Mon téléphone » (spec 077): she ties her WhatsApp or her Telegram to the center; what waits
// for her decision arrives there, and she decides by a tap. Administrators connect the
// organization's own number and bot.

export interface Phone {
  tied: boolean;
  channel: 'whatsapp' | 'telegram' | null;
  /** The channels the organization connected: only those can reach her. */
  senders: ('whatsapp' | 'telegram')[];
}

export const fetchPhone = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Phone>(getRequest(), '/v1/phone'),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export type PhoneChange =
  | { kind: 'tie'; channel: 'whatsapp'; phone: string }
  | { kind: 'tie'; channel: 'telegram' }
  | { kind: 'untie' }
  | {
      kind: 'sender';
      channel: 'whatsapp';
      phoneNumberId: string;
      accessToken: string;
      appSecret: string;
    }
  | { kind: 'sender'; channel: 'telegram'; botToken: string; webhookSecret: string };

export const changePhone = createServerFn({ method: 'POST' })
  .validator((input: unknown): PhoneChange => {
    const v = (input ?? {}) as Record<string, unknown>;
    if (v.kind === 'untie') return { kind: 'untie' };
    if (v.kind === 'tie') {
      return v.channel === 'telegram'
        ? { kind: 'tie', channel: 'telegram' }
        : { kind: 'tie', channel: 'whatsapp', phone: text(v.phone, 24) };
    }
    if (v.kind === 'sender') {
      return v.channel === 'telegram'
        ? {
            kind: 'sender',
            channel: 'telegram',
            botToken: text(v.botToken, 200),
            webhookSecret: text(v.webhookSecret, 200),
          }
        : {
            kind: 'sender',
            channel: 'whatsapp',
            phoneNumberId: text(v.phoneNumberId, 64),
            accessToken: text(v.accessToken, 1000),
            appSecret: text(v.appSecret, 200),
          };
    }
    throw new Error('Unknown.');
  })
  .handler(({ data }) => {
    const key = crypto.randomUUID();
    if (data.kind === 'untie') return sendGesture<Phone>(getRequest(), '/v1/phone/untie', {}, key);
    // What the API takes: the change without its kind.
    const body = Object.fromEntries(Object.entries(data).filter(([name]) => name !== 'kind'));
    if (data.kind === 'tie') {
      return sendGesture<Phone & { link: string | null }>(getRequest(), '/v1/phone', body, key);
    }
    return sendGesture<{ connected: string }>(getRequest(), '/v1/phone/senders', body, key);
  });
