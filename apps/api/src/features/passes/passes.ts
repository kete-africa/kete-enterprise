import type { SqlExecutor } from '@kete/tenancy';
import { createHash, randomBytes } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { GestureRefusal } from '../../platform/gestures.js';
import { findPerson } from '../structure/index.js';
import {
  insertPass,
  passByFingerprint,
  revokeFor,
  touchPass,
  type PassRow,
} from './infrastructure/passes.tables.js';

const fingerprintOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** A link's token: 32 random bytes, written for an address. */
const tokenShape = /^[A-Za-z0-9_-]{43}$/;

/**
 * Issues a personal link for a person and a purpose (`surveys.answer`, `performance.review`), in
 * the caller's transaction. The token is returned once — to be put in an e-mail — and never kept.
 */
export async function issuePass(
  db: SqlExecutor,
  organizationId: string,
  input: { personId: string; purpose: string; reference: string; expiresAt: Date },
): Promise<{ passId: string; token: string; url: string }> {
  const token = randomBytes(32).toString('base64url');
  const passId = await insertPass(db, organizationId, {
    ...input,
    fingerprint: fingerprintOf(token),
  });
  return { passId, token, url: `${env.publicWebUrl}/lien/${token}` };
}

/** Revokes every live link of a purpose and reference: a closed survey opens no more. */
export function revokePasses(db: SqlExecutor, purpose: string, reference: string) {
  return revokeFor(db, purpose, reference);
}

/** The live link behind a token, or null: wrong, expired or revoked look the same from outside. */
export async function resolvePass(token: string): Promise<PassRow | null> {
  if (!tokenShape.test(token)) return null;
  return passByFingerprint(getPool(), fingerprintOf(token));
}

export interface PassVariables {
  pass: PassRow;
}

/**
 * The routes a link opens: only for its purpose. The person acts as herself — her journal entries
 * carry her person — and reaches nothing but what the purpose's feature serves.
 */
export function requirePass(purpose: string): MiddlewareHandler<{ Variables: PassVariables }> {
  return async (c, next) => {
    const pass = await resolvePass(c.req.param('token') ?? '');
    if (!pass || pass.purpose !== purpose) {
      throw new GestureRefusal(404, 'link_invalid', 'This link is not valid, or no longer.');
    }
    await transaction(pass.organizationId, (db) => touchPass(db, pass.passId));
    c.set('pass', pass);
    await next();
  };
}

export type PassContext = Context<{ Variables: PassVariables }>;

/** `/public/passes/:token`: what a link is for, so the screens open the right page. */
export const passRoutes = new Hono().get('/:token', async (c) => {
  const pass = await resolvePass(c.req.param('token'));
  if (!pass) throw new GestureRefusal(404, 'link_invalid', 'This link is not valid, or no longer.');
  const person = await transaction(pass.organizationId, (db) => findPerson(db, pass.personId));
  return c.json({
    purpose: pass.purpose,
    reference: pass.reference,
    person: { name: person?.name ?? '' },
  });
});
