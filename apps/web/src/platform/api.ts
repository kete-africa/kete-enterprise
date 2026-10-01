import { env } from './env';
import { getSignIn } from './session';

/** The API refused the call: no session, or a token it no longer accepts. */
export class SignInRequired extends Error {
  constructor() {
    super('A sign-in with the Compte Kete is required.');
    this.name = 'SignInRequired';
  }
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
  const token = await getSignIn().accessToken(request);
  if (!token) throw new SignInRequired();
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}`, accept: 'application/json' },
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
  const token = await getSignIn().accessToken(request);
  if (!token) throw new SignInRequired();
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
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
