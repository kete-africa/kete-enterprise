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
