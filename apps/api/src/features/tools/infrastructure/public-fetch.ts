import { lookup } from 'node:dns/promises';
import { isPublicIp } from '../../registry/index.js';

// An imported tool is reached over the public internet only (spec 093): an `https` address whose
// every resolved IP is public, no redirection, a timeout and a bounded answer. An administrator
// cannot use an import to reach the company's private network, nor the instance's own.

const LIMIT = 2_000_000;

/** Whether an address may be reached: https, and every IP it resolves to is public. */
export async function reachable(address: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const resolved = await lookup(url.hostname, { all: true }).catch(() => []);
  return resolved.length > 0 && resolved.every((r) => isPublicIp(r.address));
}

/** A fetch that refuses what is not public, follows no redirection and cuts a long answer. */
export const publicFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (!(await reachable(request.url))) {
    throw new Error('This address is not on the public internet.');
  }
  const response = await fetch(request, {
    redirect: 'error',
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > LIMIT) throw new Error('The answer is too long.');
  return response;
};

let current: typeof fetch = publicFetch;

/** Tests: reach the tools another way (servers in memory). */
export function useToolsFetch(next: typeof fetch | undefined): void {
  current = next ?? publicFetch;
}

/** The fetch in use. */
export const toolsFetch: typeof fetch = (input, init) => current(input, init);

/** Whether an address may be reached with the fetch in use (a test's servers are its own). */
export const allowed = (address: string): Promise<boolean> =>
  current === publicFetch ? reachable(address) : Promise.resolve(address.startsWith('https://'));
