import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Third parties (spec 073, doctrine D-047): who the organization works with — one record each,
// cited by every app, with what each app knows of it.

export type PartyRole = 'client' | 'supplier' | 'funder' | 'partner';
export const partyRoles: PartyRole[] = ['client', 'supplier', 'funder', 'partner'];

export interface Party {
  partyId: string;
  kind: 'company' | 'person';
  name: string;
  roles: PartyRole[];
  email: string | null;
  phone: string | null;
  address: string | null;
  registration: string | null;
  channel: 'whatsapp' | 'telegram' | 'email' | 'phone' | null;
  mergedFrom: string[];
}

export interface PartyFact {
  source: string;
  key: string;
  label: string;
  state: string | null;
  href: string | null;
  updatedAt: string;
}

export interface Duplicate {
  a: { partyId: string; name: string };
  b: { partyId: string; name: string };
  because: ('name' | 'phone' | 'email')[];
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const partyId = (value: unknown) => {
  if (typeof value !== 'string' || !/^pty_[0-9a-f-]{8,64}$/.test(value))
    throw new Error('Unknown.');
  return value;
};

export const fetchParties = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ q: text((input as { q?: unknown } | null)?.q, 120) }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const listed = await callApi<{ parties: Party[]; manages: boolean }>(
      request,
      `/v1/parties${data.q ? `?q=${encodeURIComponent(data.q)}` : ''}`,
    );
    const found = listed.manages
      ? await callApi<{ duplicates: Duplicate[] }>(request, '/v1/parties/duplicates').catch(() => ({
          duplicates: [],
        }))
      : { duplicates: [] };
    return { ...listed, duplicates: found.duplicates };
  });

export const fetchParty = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ partyId: partyId((input as { partyId?: unknown })?.partyId) }))
  .handler(({ data }) =>
    callApi<{ party: Party; facts: PartyFact[] }>(
      getRequest(),
      `/v1/parties/${data.partyId}`,
    ).catch(() => null),
  );

export const createParty = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(v.roles)
      ? v.roles.filter((role): role is PartyRole => partyRoles.includes(role as PartyRole))
      : [];
    return {
      kind: v.kind === 'person' ? ('person' as const) : ('company' as const),
      name: text(v.name, 200),
      roles,
      phone: text(v.phone, 40),
      email: text(v.email, 320),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ party: Party }>(
      getRequest(),
      '/v1/parties',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, partyId: answer.data.party.partyId, error: null }
      : { ok: false as const, partyId: null, error: answer.error };
  });

/** Two records are one third party (`merge`), or are not (`distinct`). */
export const settleDuplicate = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { keep?: unknown; merge?: unknown; same?: unknown };
    return { keep: partyId(v.keep), merge: partyId(v.merge), same: v.same === true };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      data.same ? '/v1/parties/merge' : '/v1/parties/distinct',
      { keep: data.keep, merge: data.merge },
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });
