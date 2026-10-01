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

/** A feature declares a subject of requests, and what deciding one does. */
export function registerSubject(subject: string, handler: SubjectHandler): void {
  subjects.set(subject, handler);
}

export function knownSubjects(): string[] {
  return [...subjects.keys()].sort();
}

/** Carries a decided request out: its subject's feature applies the outcome. */
export async function settle(
  db: SqlExecutor,
  request: Pick<DecisionRequest, 'requestId' | 'subject' | 'reference'>,
  outcome: 'approved' | 'refused',
  decidedBy: string,
): Promise<void> {
  await closeRequest(db, request.requestId, outcome);
  const handler = subjects.get(request.subject);
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
