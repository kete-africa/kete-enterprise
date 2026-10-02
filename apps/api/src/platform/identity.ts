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
/**
 * The audiences the API accepts: Kete apps' tokens, and those a copilot asked for the MCP gateway
 * itself (RFC 8707, kete-core spec 038).
 */
export function acceptedAudiences(): string[] {
  return ['urn:kete:apps', ...(env.publicApiUrl ? [`${env.publicApiUrl}/mcp`] : [])];
}

function verify(token: string): Promise<KeteIdentity> {
  verifier ??= createTokenVerifier({ issuer: env.accountUrl, audience: acceptedAudiences() });
  return verifier(token);
}

/** The person behind a request's bearer token, with her organization; null otherwise. */
export async function identityOf(request: Request): Promise<IdentityVariables['identity'] | null> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  try {
    const identity = await verify(token);
    return identity.organizationId
      ? { ...identity, organizationId: identity.organizationId }
      : null;
  } catch {
    return null;
  }
}

/** Tests: verify tokens with other keys. */
export function useVerifier(next: TokenVerifier): void {
  verifier = next;
}

export interface IdentityVariables {
  identity: KeteIdentity & { organizationId: string };
  /** In a demo organization, the administrator who views the space as `identity` (spec 010). */
  viewedBy?: string;
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
