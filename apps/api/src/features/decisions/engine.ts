import type { SqlExecutor } from '@kete/tenancy';
import { currentStep, type DecisionRequest } from './decisions.record.js';
import {
  activeCircuit,
  approversOf,
  closeRequest,
  findRequest,
  insertRequest,
} from './infrastructure/decisions.tables.js';

/** What a feature does once a request of its subject is decided, in the same transaction. */
export type SubjectHandler = (
  db: SqlExecutor,
  reference: string,
  outcome: 'approved' | 'refused',
  decidedBy: string,
) => Promise<void>;

const subjects = new Map<string, SubjectHandler>();
const families: { matches: (subject: string) => boolean; handler: SubjectHandler }[] = [];

/** A subject, and its words when they come from an app's card. */
export interface SubjectEntry {
  subject: string;
  label?: { fr: string; en: string };
}

/** Where subjects come from beyond the features: the apps' cards (spec 023). */
export type SubjectSource = (db: SqlExecutor) => Promise<SubjectEntry[]>;
const sources: SubjectSource[] = [];

/** What is told once a request is decided, outside its transaction: an app is told (spec 023). */
export type DecidedListener = (organizationId: string, requestId: string) => Promise<void>;
const listeners: DecidedListener[] = [];

/** A feature declares a subject of requests, and what deciding one does. */
export function registerSubject(subject: string, handler: SubjectHandler): void {
  subjects.set(subject, handler);
}

/** A family of subjects handled alike: the apps' (`prd_….…`, spec 023). */
export function registerSubjectFamily(
  matches: (subject: string) => boolean,
  handler: SubjectHandler,
  source: SubjectSource,
): void {
  families.push({ matches, handler });
  sources.push(source);
}

/**
 * What is told when a request waits for new approvers, in its transaction: they are notified
 * (spec 030). A listener that fails never fails the request.
 */
export type WaitingListener = (
  db: SqlExecutor,
  organizationId: string,
  request: DecisionRequest,
  approvers: Set<string>,
) => Promise<void>;
const waitingListeners: WaitingListener[] = [];

export function onWaiting(listener: WaitingListener): void {
  waitingListeners.push(listener);
}

/** Tells the listeners who must decide a request now, if anyone. */
export async function announceWaiting(
  db: SqlExecutor,
  organizationId: string,
  requestId: string,
): Promise<void> {
  const request = await findRequest(db, requestId);
  if (!request) return;
  const approvers = await approversNow(db, request);
  if (!approvers || approvers.people.size === 0) return;
  for (const listener of waitingListeners) {
    await listener(db, organizationId, request, approvers.people).catch((error: unknown) => {
      console.error('[decisions]', (error as Error).message);
    });
  }
}

/** Listens to decided requests, once their transaction is over. */
export function onDecided(listener: DecidedListener): void {
  listeners.push(listener);
}

/** Tells the listeners a request was decided; a listener that fails never fails the decision. */
export async function announceDecided(organizationId: string, requestId: string): Promise<void> {
  for (const listener of listeners) {
    await listener(organizationId, requestId).catch((error: unknown) => {
      console.error('[decisions]', (error as Error).message);
    });
  }
}

export function knownSubjects(): string[] {
  return [...subjects.keys()].sort();
}

/** Every subject a circuit may be defined for in this organization, with its words if any. */
export async function subjectsOf(db: SqlExecutor): Promise<SubjectEntry[]> {
  const fromApps = (await Promise.all(sources.map((source) => source(db)))).flat();
  return [...knownSubjects().map((subject) => ({ subject })), ...fromApps];
}

function handlerOf(subject: string): SubjectHandler | undefined {
  return subjects.get(subject) ?? families.find((f) => f.matches(subject))?.handler;
}

/** Carries a decided request out: its subject's feature applies the outcome. */
export async function settle(
  db: SqlExecutor,
  request: Pick<DecisionRequest, 'requestId' | 'subject' | 'reference'>,
  outcome: 'approved' | 'refused',
  decidedBy: string,
): Promise<void> {
  await closeRequest(db, request.requestId, outcome);
  const handler = handlerOf(request.subject);
  if (!handler) throw new Error(`No feature handles the subject ${request.subject}.`);
  await handler(db, request.reference, outcome, decidedBy);
}

/**
 * Opens a request of a subject in the caller's transaction, if a circuit is active for it; null
 * otherwise (the feature keeps its own review). A request whose every step falls under its
 * threshold needs nobody: it is approved at once.
 */
export async function openRequest(
  db: SqlExecutor,
  organizationId: string,
  input: {
    subject: string;
    reference: string;
    title: string;
    requesterUserId: string;
    unitId: string | null;
    measure: number | null;
  },
): Promise<string | null> {
  const circuit = await activeCircuit(db, input.subject);
  if (!circuit) return null;
  const requestId = await insertRequest(db, organizationId, { circuit, ...input });
  const request = (await findRequest(db, requestId)) as DecisionRequest;
  if (!currentStep(request)) await settle(db, request, 'approved', 'circuit');
  else await announceWaiting(db, organizationId, requestId);
  return requestId;
}

/**
 * Who may decide the request now: the current step's approvers, never its requester. A step that
 * finds nobody else goes to the organization's administrators.
 */
export async function approversNow(
  db: SqlExecutor,
  request: DecisionRequest,
): Promise<{ people: Set<string>; administrators: boolean } | null> {
  const step = currentStep(request);
  if (!step) return null;
  const people = await approversOf(db, request, step.rule);
  people.delete(request.requesterUserId);
  return { people, administrators: people.size === 0 };
}

export async function mayDecide(
  db: SqlExecutor,
  request: DecisionRequest,
  userId: string,
  administrator: boolean,
): Promise<boolean> {
  if (userId === request.requesterUserId) return false;
  const approvers = await approversNow(db, request);
  if (!approvers) return false;
  return approvers.people.has(userId) || (approvers.administrators && administrator);
}
