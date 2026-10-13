import type { SqlExecutor } from '@kete/tenancy';
import { currentStep, type DecisionRequest } from './decisions.record.js';
import {
  activeCircuit,
  approversOf,
  closeRequest,
  enterStep,
  findRequest,
  insertRequest,
  passInformed,
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

/** The words of the features' own subjects: a person reads them, never the subject's code. */
const ownLabels = new Map<string, { fr: string; en: string }>();

/** A feature declares a subject of requests, what deciding one does, and its words. */
export function registerSubject(
  subject: string,
  handler: SubjectHandler,
  label?: { fr: string; en: string },
): void {
  subjects.set(subject, handler);
  if (label) ownLabels.set(subject, label);
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

/**
 * What is told when a step only informs, or when a request is sent back to who asked — in its
 * transaction (spec 075). A listener that fails never fails the request.
 */
export type ToldListener = (
  db: SqlExecutor,
  organizationId: string,
  request: DecisionRequest,
  people: Set<string>,
  why: 'informed' | 'returned',
) => Promise<void>;
const toldListeners: ToldListener[] = [];

export function onTold(listener: ToldListener): void {
  toldListeners.push(listener);
}

async function announceTold(
  db: SqlExecutor,
  organizationId: string,
  request: DecisionRequest,
  people: Set<string>,
  why: 'informed' | 'returned',
): Promise<void> {
  if (people.size === 0) return;
  for (const listener of toldListeners) {
    await listener(db, organizationId, request, people, why).catch((error: unknown) => {
      console.error('[decisions]', (error as Error).message);
    });
  }
}

/** Who asked is told her request came back, with the reason given. */
export async function announceReturned(
  db: SqlExecutor,
  organizationId: string,
  requestId: string,
): Promise<void> {
  const request = await findRequest(db, requestId);
  if (request) {
    await announceTold(db, organizationId, request, new Set([request.requesterUserId]), 'returned');
  }
}

/**
 * Moves a request on: a step that only informs tells its people and is passed; the first step
 * that needs a decision waits, its approvers told; with none left, the request is approved.
 */
export async function advance(
  db: SqlExecutor,
  organizationId: string,
  requestId: string,
  decidedBy: string,
): Promise<{ status: 'pending'; step: number } | { status: 'approved' }> {
  for (;;) {
    const request = (await findRequest(db, requestId)) as DecisionRequest;
    const step = currentStep(request);
    if (!step) {
      await settle(db, request, 'approved', decidedBy);
      return { status: 'approved' };
    }
    if (step.inform) {
      const people = await approversOf(db, request, step.rule);
      people.delete(request.requesterUserId);
      await announceTold(db, organizationId, request, people, 'informed');
      await passInformed(db, requestId, step.position);
      continue;
    }
    await enterStep(db, requestId, step.position);
    await announceWaiting(db, organizationId, requestId);
    return { status: 'pending', step: step.position };
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
  return [
    ...knownSubjects().map((subject) => {
      const label = ownLabels.get(subject);
      return label ? { subject, label } : { subject };
    }),
    ...fromApps,
  ];
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
    /** The project it belongs to: a step of its circuit may be its lead's. */
    projectId?: string | null;
  },
): Promise<string | null> {
  const circuit = await activeCircuit(db, input.subject);
  if (!circuit) return null;
  const requestId = await insertRequest(db, organizationId, { circuit, ...input });
  await advance(db, organizationId, requestId, 'circuit');
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
