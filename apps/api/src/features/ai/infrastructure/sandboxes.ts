import { boatProvider, type SandboxProvider } from '@kete/sandbox';

// The instance's sandboxes (`KETE_SANDBOX_API_KEY`): the machines where a person's subscription
// answers (spec 026b) and where an agent works on a computer of its own (spec 094). The provider's
// name stays here.

let provider: SandboxProvider | null | undefined;

/** The sandbox provider, or null when the instance has none. */
export function sandboxProvider(): SandboxProvider | null {
  if (provider === undefined) {
    const apiKey = process.env.KETE_SANDBOX_API_KEY?.trim();
    provider = apiKey ? boatProvider({ apiKey }) : null;
  }
  return provider;
}

/** Tests: sandboxes of their own (in memory), or none. */
export function useSandboxProvider(next: SandboxProvider | null | undefined): void {
  provider = next;
}
