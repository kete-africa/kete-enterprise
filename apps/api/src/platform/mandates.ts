import { createAppToken, createMandates, createStandingMandates } from '@kete/auth';
import { env } from './env.js';

// An agent's mandate (spec 024, kete-core spec 049): when an agent of Kete Enterprise — the
// assistant, a background agent — calls a team's app for a person, it carries a mandate the Compte
// Kete signs: the person's same claims, and the agent named. The app knows who acts and for whom;
// the agent never holds more than the person. While she is away (spec 108, kete-core spec 150),
// the agent carries the mandate she gave it ahead of time — her claims read again at each use.

export interface Agent {
  id: string;
  name: string;
}

type Mandates = (subjectToken: string, agent: Agent) => Promise<string | null>;
let mandates: Mandates | null | undefined;

/** The center's side of a standing mandate: given once, asked at each use, withdrawn. */
export interface StandingMandates {
  grant(subjectToken: string, agent: Agent): Promise<string | null>;
  token(organizationId: string, grant: string): Promise<string | null>;
  revoke(organizationId: string, grant: string): Promise<boolean>;
}
let standing: StandingMandates | null | undefined;

/** Whether mandates are on: Kete Enterprise's client holds `kete:mandate` at the Compte Kete. */
export function mandatesOn(): boolean {
  return (
    process.env.KETE_MANDATES === 'on' &&
    !!process.env.KETE_CLIENT_ID &&
    !!process.env.KETE_CLIENT_SECRET
  );
}

let appToken: (() => Promise<string | null>) | undefined;
const centerToken = () =>
  (appToken ??= createAppToken({
    accountUrl: env.accountUrl,
    clientId: process.env.KETE_CLIENT_ID ?? '',
    clientSecret: process.env.KETE_CLIENT_SECRET ?? '',
    scope: 'kete:mandate',
  }));

function current(): Mandates | null {
  if (mandates !== undefined) return mandates;
  if (!mandatesOn()) return null;
  mandates = createMandates({ accountUrl: env.accountUrl, appToken: centerToken() });
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

/** Standing mandates, when mandates are on; null otherwise — an agent away then reaches no app. */
export function standingMandates(): StandingMandates | null {
  if (standing !== undefined) return standing;
  if (!mandatesOn()) return null;
  const made = createStandingMandates({ accountUrl: env.accountUrl, appToken: centerToken() });
  standing = made;
  return made;
}

/** Tests: exchange tokens another way (null: mandates off). */
export function useMandates(next: Mandates | null): void {
  mandates = next;
}

/** Tests: standing mandates another way (null: mandates off; undefined: as configured). */
export function useStandingMandates(next: StandingMandates | null | undefined): void {
  standing = next;
}
