import { validateManifest } from '@kete/sdk';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { IdentityCard } from '../registry.record.js';

/** Reads an app's identity card from its address; null when it has none, or none that is valid. */
export type CardReader = (address: string) => Promise<IdentityCard | null>;

/** Whether an IP address is on the public internet (never a private, loopback or link-local one). */
export function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  const v6 = address.toLowerCase();
  if (v6 === '::1' || v6 === '::') return false;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return false;
  if (v6.startsWith('::ffff:')) return isPublicIp(v6.slice('::ffff:'.length));
  return true;
}

/**
 * The registry reads cards over the public internet only: an `https` address whose every resolved
 * IP is public, no redirection, a short timeout and a small body. A person cannot use the registry
 * to reach the company's private network.
 */
export const readIdentityCard: CardReader = async (address) => {
  const url = new URL('/.well-known/kete', address);
  if (url.protocol !== 'https:') return null;
  const resolved = await lookup(url.hostname, { all: true }).catch(() => []);
  if (resolved.length === 0 || !resolved.every((r) => isPublicIp(r.address))) return null;
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'application/json' },
  }).catch(() => null);
  if (!response?.ok) return null;
  const text = await response.text();
  if (text.length > 100_000) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  return validateManifest(manifest).ok ? (manifest as IdentityCard) : null;
};
