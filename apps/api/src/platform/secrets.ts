import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Secrets a person entrusts to Kete Enterprise (spec 026): sealed at rest with AES-256-GCM under
// the instance's key (`KETE_SECRETS_KEY`, 32 random bytes in base64), never returned, never logged.

function key(): Buffer | null {
  const value = process.env.KETE_SECRETS_KEY ?? '';
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 ? bytes : null;
}

/** Whether the instance can keep secrets: its key is set. */
export function secretsOn(): boolean {
  return key() !== null;
}

/** Seals a secret: `v1.<iv>.<tag>.<ciphertext>`, each in base64url. */
export function seal(secret: string): string {
  const k = key();
  if (!k) throw new Error('KETE_SECRETS_KEY is not set: no secret is kept.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const sealed = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), sealed]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Opens a sealed secret; null when it was sealed under another key, or tampered with. */
export function open(sealed: string): string | null {
  const k = key();
  const [version, iv, tag, data] = sealed.split('.');
  if (!k || version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
