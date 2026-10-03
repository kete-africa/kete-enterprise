import { newEventId } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 025: an app announces its business facts with its own token; Kete Enterprise keeps each
// event once, for the organization whose registry holds the app, and only the types its card
// declares; its people read them in their briefing — never a secret one.

// An organization id as the Compte Kete issues them (`event.v1` asks at least four characters).
const ORG = 'org_kyademo';

let db: TestSchema;
const api = createApi();
const t = { ama: '', kofi: '' };

const card: IdentityCard = {
  product: 'prd_kete_helpdesk',
  name: 'Support',
  version: '1.0.0',
  client: 'cli_helpdesk',
  emits: [
    { type: 'ticket.opened', description: 'A ticket was opened', classification: 'internal' },
    { type: 'pay.changed', description: 'A pay changed', classification: 'secret' },
  ],
};

const event = (type: string, organization = ORG, product = 'prd_kete_helpdesk') => ({
  id: newEventId(),
  type,
  specversion: '1',
  product,
  organization,
  occurred_at: new Date().toISOString(),
  data: { ticketId: 'tkt_1' },
});

async function deliver(token: string | null, events: object[]) {
  const response = await api.request('/public/apps/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ events }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  db = await startApi();
  // An app's token, as the Compte Kete issues it: here, its text names its client.
  useAppVerifier(async (token) => {
    if (!token.startsWith('app:')) throw new Error('not an app');
    return {
      clientId: token.slice(4),
      scopes: ['kete:center'],
      expiresAt: new Date(Date.now() + 60_000),
    };
  });
  useCardReader(async (address) => (address.includes('helpdesk') ? card : null));
  t.ama = await tokenFor('usr_ama', { role: 'admin', org: ORG });
  t.kofi = await tokenFor('usr_kofi', { org: ORG });
  const registered = await api.request('/v1/registry/resources', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${t.ama}`,
      'content-type': 'application/json',
      'idempotency-key': 'register-helpdesk',
    },
    body: JSON.stringify({
      kind: 'app',
      name: 'Support',
      address: 'https://helpdesk.example.test',
    }),
  });
  expect(registered.status).toBe(201);
});

afterAll(async () => {
  await db?.drop();
});

describe('the apps’ events', () => {
  it('are taken only with an app’s own token', async () => {
    expect((await deliver(null, [event('ticket.opened')])).status).toBe(401);
    expect((await deliver(t.kofi, [event('ticket.opened')])).status).toBe(401);
  });

  it('are kept once, for the organization whose registry holds the app', async () => {
    const opened = event('ticket.opened');
    const first = await deliver('app:cli_helpdesk', [opened]);
    expect(first).toEqual({
      status: 200,
      body: { results: [{ id: opened.id, outcome: 'accepted' }] },
    });
    const again = await deliver('app:cli_helpdesk', [opened]);
    expect(again.body).toEqual({ results: [{ id: opened.id, outcome: 'duplicate' }] });
  });

  it('are refused from an app another registry holds, or of a type not declared', async () => {
    const elsewhere = event('ticket.opened', 'org_other');
    const stranger = await deliver('app:cli_stranger', [event('ticket.opened')]);
    const undeclared = await deliver('app:cli_helpdesk', [event('ticket.deleted'), elsewhere]);
    expect(stranger.body).toMatchObject({
      results: [{ outcome: 'refused', reason: 'unknown_app' }],
    });
    expect(undeclared.body).toMatchObject({
      results: [
        { outcome: 'refused', reason: 'undeclared_type' },
        { id: elsewhere.id, outcome: 'refused', reason: 'unknown_app' },
      ],
    });
  });

  it('reach the briefing’s facts, never a secret one', async () => {
    await deliver('app:cli_helpdesk', [event('ticket.opened'), event('pay.changed')]);
    const response = await api.request('/v1/workspace', {
      headers: { authorization: `Bearer ${t.ama}` },
    });
    const facts = (await response.json()) as { appNews: { type: string; count: number }[] };
    expect(facts.appNews).toEqual([
      expect.objectContaining({ app: 'Support', type: 'ticket.opened', count: 2 }),
    ]);
  });
});
