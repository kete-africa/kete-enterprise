import {
  createTokenVerifier,
  InvalidTokenError,
  type KeteIdentity,
  type TokenVerifier,
} from '@kete/auth';
import type { MiddlewareHandler } from 'hono';
import { env } from './env.js';

let verifier: TokenVerifier | undefined;

/** People's tokens: issued by the identity, verified with its published keys. */
function verify(token: string): Promise<KeteIdentity> {
  verifier ??= createTokenVerifier({ issuer: env.accountUrl });
  return verifier(token);
}

/** Tests: verify tokens with other keys. */
export function useVerifier(next: TokenVerifier): void {
  verifier = next;
}

export interface IdentityVariables {
  identity: KeteIdentity & { organizationId: string };
}

/**
 * Every call carries a person's token (`Authorization: Bearer …`): the screens, the MCP gateway,
 * agents and connected apps alike. A call without a valid token, or without an organization, is
 * refused; an expired token says so, so the caller can fetch a fresh one.
 */
export const requirePerson: MiddlewareHandler<{ Variables: IdentityVariables }> = async (
  c,
  next,
) => {
  const header = c.req.header('authorization') ?? '';
  const token = /^Bearer (.+)$/.exec(header)?.[1];
  if (!token) return c.json({ error: 'unauthenticated' }, 401);
  let identity: KeteIdentity;
  try {
    identity = await verify(token);
  } catch (error) {
    const code = error instanceof InvalidTokenError ? error.code : 'invalid';
    return c.json({ error: code === 'expired' ? 'token_expired' : 'unauthenticated' }, 401);
  }
  const organizationId = identity.organizationId;
  if (!organizationId) return c.json({ error: 'no_organization' }, 403);
  c.set('identity', { ...identity, organizationId });
  await next();
};
