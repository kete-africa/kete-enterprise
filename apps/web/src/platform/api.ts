import { env } from './env';
import { getSignIn } from './session';

/** The API refused the call: no session, or a token it no longer accepts. */
export class SignInRequired extends Error {
  constructor() {
    super('A sign-in with the Compte Kete is required.');
    this.name = 'SignInRequired';
  }
}

/** The cookie that holds the person a demo's administrator views the space as (spec 010). */
export const VIEW_AS_COOKIE = 'kete_view_as';

function viewedPerson(request: Request): string | null {
  const cookies = request.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${VIEW_AS_COOKIE}=(prs_[0-9a-f-]{8,64})`).exec(cookies);
  return match?.[1] ?? null;
}

/** The person's token, and the person she views the space as when there is one. */
async function headersFor(request: Request): Promise<Record<string, string>> {
  const token = await getSignIn().accessToken(request);
  if (!token) throw new SignInRequired();
  const viewed = viewedPerson(request);
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...(viewed ? { 'kete-view-as': viewed } : {}),
  };
}

/**
 * Calls Kete Enterprise's API as the person of this request, with her token (server-side only).
 * Without a session, or with a token the API refuses, the person signs in again.
 */
export async function callApi<T>(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: { ...init.headers, ...(await headersFor(request)) },
  });
  if (response.status === 401) throw new SignInRequired();
  if (!response.ok) throw new Error(`API ${init.method ?? 'GET'} ${path}: ${response.status}`);
  return (await response.json()) as T;
}

/** What a gesture answered: its result, or the API's refusal code (translated by the screens). */
export type GestureAnswer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Sends a gesture to the API as the person of this request, through the channel `web`, with a
 * fresh idempotency key: a refusal comes back as its code, never as an exception.
 */
export async function sendGesture<T>(
  request: Request,
  path: string,
  body: unknown,
  idempotencyKey: string,
): Promise<GestureAnswer<T>> {
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      ...(await headersFor(request)),
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'kete-channel': 'web',
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new SignInRequired();
  const answer = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) return { ok: false, error: answer.error ?? 'internal' };
  return { ok: true, data: answer as T };
}

/**
 * A personal link's call (spec 010): no account, no token — the link itself opens its purpose.
 * A refusal comes back as its code.
 */
export async function callPublic<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
): Promise<GestureAnswer<T>> {
  const response = await fetch(`${env.apiUrl}/public${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const answer = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) return { ok: false, error: answer.error ?? 'internal' };
  return { ok: true, data: answer as T };
}
