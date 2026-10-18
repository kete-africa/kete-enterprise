import { publicFetch, reachable } from '@kete/tools';

// An imported tool is reached over the public internet only (spec 093): `@kete/tools`' guard — an
// `https` address whose every resolved IP is public, checked again at the very moment of
// connecting (no DNS rebinding, kete-core spec 134), no redirection, a timeout and a bounded
// answer. An administrator cannot use an import to reach the company's private network, nor the
// instance's own.

export { reachable };

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
