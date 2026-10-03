import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
export const requestId = id('drq');

/**
 * A subject is a feature and a kind of request: `registry.promotion`; an app's is its product and
 * its subject: `prd_kete_purchases.purchase` (spec 023).
 */
export const subject = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

/**
 * Who approves a step, found when someone looks (doctrine D-028: by relation or by role):
 * the requester's manager (the position her primary position reports to), the holders of a role
 * covering the request's unit, a position's holders, or a person.
 */
export const approverRule = z.discriminatedUnion('rule', [
  z.object({ rule: z.literal('manager') }),
  z.object({ rule: z.literal('role'), roleId: id('rol') }),
  z.object({ rule: z.literal('position'), positionId: id('pos') }),
  z.object({ rule: z.literal('person'), personId: id('prs') }),
]);
export type ApproverRule = z.infer<typeof approverRule>;

export const stepInput = z.intersection(
  approverRule,
  z.object({
    /** The step applies from this measure (an amount, a risk level); always without one. */
    minMeasure: z.number().nonnegative().optional(),
  }),
);
export type StepInput = z.infer<typeof stepInput>;

export const defineCircuitInput = z.object({
  subject,
  name: z.string().trim().min(1).max(120),
  /** After this delay, a waiting step is flagged overdue. */
  remindAfterHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(48),
  steps: z.array(stepInput).min(1).max(10),
});

export const decideRequestInput = z.object({
  requestId,
  decision: z.enum(['approve', 'refuse']),
  reason: z.string().trim().max(1000).optional(),
});

export interface CircuitStep {
  position: number;
  rule: ApproverRule;
  minMeasure: number | null;
}

export interface Circuit {
  circuitId: string;
  subject: string;
  name: string;
  remindAfterHours: number;
  steps: CircuitStep[];
}

export type RequestStatus = 'pending' | 'approved' | 'refused';
export type StepStatus = 'pending' | 'approved' | 'refused' | 'skipped';

export interface DecisionStep {
  position: number;
  rule: ApproverRule;
  minMeasure: number | null;
  status: StepStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  enteredAt: string | null;
}

export interface DecisionRequest {
  requestId: string;
  circuitId: string;
  subject: string;
  reference: string;
  title: string;
  requesterUserId: string;
  unitId: string | null;
  measure: number | null;
  status: RequestStatus;
  createdAt: string;
  steps: DecisionStep[];
}

/** The step waiting for a decision, if any. */
export function currentStep(request: DecisionRequest): DecisionStep | null {
  if (request.status !== 'pending') return null;
  return request.steps.find((s) => s.status === 'pending') ?? null;
}
