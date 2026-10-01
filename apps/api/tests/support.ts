import { createTokenVerifier } from '@kete/auth';
import { createTestSchema, type TestSchema } from '@kete/testing';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { migrations } from '../db/migrations.js';
import { usePool } from '../src/platform/db.js';
import { useVerifier } from '../src/platform/identity.js';

const issuer = 'https://compte.kete.test';
let privateKey: CryptoKey;

/** A test schema with every migration, and the API reading tokens signed by a test key. */
export async function startApi(): Promise<TestSchema> {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'EdDSA' };
  useVerifier(createTokenVerifier({ issuer, jwks: { keys: [jwk] } }));
  const db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  return db;
}

/** A person's token, as the Compte Kete issues it. */
export function tokenFor(
  userId: string,
  claims: { org?: string | null; role?: string | null; name?: string } = {},
): Promise<string> {
  return new SignJWT({
    email: `${userId}@example.test`,
    name: claims.name ?? userId,
    org: claims.org === undefined ? 'org_kya' : claims.org,
    role: claims.role === undefined ? 'member' : claims.role,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-1' })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('urn:kete:apps')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}

export const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
