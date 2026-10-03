import { createAppToken, createMandates } from '@kete/auth';
import { env } from './env.js';

// An agent's mandate (spec 024, kete-core spec 049): when an agent of Kete Enterprise — the
// assistant, a background agent — calls a team's app for a person, it carries a mandate the Compte
// Kete signs: the person's same claims, and the agent named. The app knows who acts and for whom;
// the agent never holds more than the person.

export interface Agent {
  id: string;
  name: string;
}

type Mandates = (subjectToken: string, agent: Agent) => Promise<string | null>;
let mandates: Mandates | null | undefined;

/** Whether mandates are on: Kete Enterprise's client holds `kete:mandate` at the Compte Kete. */
export function mandatesOn(): boolean {
  return (
    process.env.KETE_MANDATES === 'on' &&
    !!process.env.KETE_CLIENT_ID &&
    !!process.env.KETE_CLIENT_SECRET
  );
}

function current(): Mandates | null {
  if (mandates !== undefined) return mandates;
  if (!mandatesOn()) return null;
  mandates = createMandates({
    accountUrl: env.accountUrl,
    appToken: createAppToken({
      accountUrl: env.accountUrl,
      clientId: process.env.KETE_CLIENT_ID ?? '',
      clientSecret: process.env.KETE_CLIENT_SECRET ?? '',
      scope: 'kete:mandate',
    }),
  });
  return mandates;
}

/**
 * The token an agent carries to an app for the person: her mandate when mandates are on — null if
 * the Compte Kete refuses, and the agent then does not call the app; her own token otherwise.
 */
export async function tokenForAgent(personToken: string, agent: Agent): Promise<string | null> {
  const exchange = current();
  return exchange ? exchange(personToken, agent) : personToken;
}

/** Tests: exchange tokens another way (null: mandates off). */
export function useMandates(next: Mandates | null): void {
  mandates = next;
}
