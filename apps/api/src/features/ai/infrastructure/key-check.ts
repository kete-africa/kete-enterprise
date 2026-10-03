import type { PersonalProvider } from '../connections.js';

// Whether a key opens its provider, by listing its models: no tokens spent. The providers' names
// and addresses stay here, in the infrastructure (constitution: no vendor in the domain).

export type KeyCheck = 'ok' | 'invalid' | 'unreachable';
export type KeyChecker = (provider: PersonalProvider, apiKey: string) => Promise<KeyCheck>;

const endpoints: Record<PersonalProvider, (key: string) => [string, Record<string, string>]> = {
  openai: (key) => ['https://api.openai.com/v1/models', { authorization: `Bearer ${key}` }],
  anthropic: (key) => [
    'https://api.anthropic.com/v1/models',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  ],
  mistral: (key) => ['https://api.mistral.ai/v1/models', { authorization: `Bearer ${key}` }],
  deepseek: (key) => ['https://api.deepseek.com/models', { authorization: `Bearer ${key}` }],
};

let checker: KeyChecker = async (provider, apiKey) => {
  const [url, headers] = endpoints[provider](apiKey);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) }).catch(
    () => null,
  );
  if (!response) return 'unreachable';
  if (response.status === 401 || response.status === 403) return 'invalid';
  return response.ok ? 'ok' : 'unreachable';
};

export function checkKey(provider: PersonalProvider, apiKey: string): Promise<KeyCheck> {
  return checker(provider, apiKey);
}

/** Tests: check keys another way. */
export function useKeyChecker(next: KeyChecker): void {
  checker = next;
}
