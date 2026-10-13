import { defineCommand } from '@kete/commands';
import { z } from 'zod';
import {
  currentStep,
  decideRequestInput,
  defineCircuitInput,
  resubmitRequestInput,
} from './decisions.record.js';
import { advance, announceReturned, mayDecide, settle, subjectsOf } from './engine.js';
import {
  decideStep,
  findRequest,
  insertCircuit,
  resubmitRequest as resubmit,
  returnRequest,
} from './infrastructure/decisions.tables.js';

/** A rule of the decisions was not met: the change is refused, nothing is written. */
export class DecisionRuleError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'unknown_subject'
      | 'decided'
      | 'not_an_approver'
      | 'reason_required'
      | 'not_returned'
      | 'not_the_requester',
    message: string,
  ) {
    super(message);
    this.name = 'DecisionRuleError';
  }
}

export const defineCircuit = defineCommand({
  name: 'define-circuit',
  input: defineCircuitInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    if (!(await subjectsOf(db)).some((s) => s.subject === input.subject)) {
      throw new DecisionRuleError('unknown_subject', `No feature handles ${input.subject}.`);
    }
    try {
      return await insertCircuit(db, organizationId, input);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new DecisionRuleError('not_found', 'A role, position or person does not exist here.');
      }
      throw error;
    }
  },
  summarize: (input) =>
    `Circuit "${input.name}" for ${input.subject}, ${input.steps.length} step(s)`,
});

export const decideRequest = defineCommand({
  name: 'decide-request',
  // Whether the person is one of the organization's administrators: the API says so, never her.
  input: decideRequestInput.extend({ administrator: z.boolean() }),
  reversibility: { reversible: false },
  async handler(input, { db, actor, organizationId }) {
    const request = await findRequest(db, input.requestId, { lock: true });
    if (!request) throw new DecisionRuleError('not_found', 'The request does not exist here.');
    const step = currentStep(request);
    if (!step) throw new DecisionRuleError('decided', 'This request was already decided.');
    // A decision is a person's: an agent never decides for her (principle 3, D-039).
    if (actor.kind !== 'person' || !(await mayDecide(db, request, actor.id, input.administrator))) {
      throw new DecisionRuleError('not_an_approver', 'This step is not for this person.');
    }
    if (input.decision === 'return') {
      // Sent back to who asked: she corrects and sends again, without a new request (spec 075).
      if (!input.reason) {
        throw new DecisionRuleError('reason_required', 'Say what is to be corrected.');
      }
      await returnRequest(db, request.requestId, actor.id, input.reason);
      await announceReturned(db, organizationId, request.requestId);
      return { requestId: request.requestId, status: 'returned' };
    }
    const status = input.decision === 'approve' ? 'approved' : 'refused';
    await decideStep(db, request.requestId, step.position, status, actor.id, input.reason ?? null);
    if (status === 'refused') {
      await settle(db, request, 'refused', actor.id);
      return { requestId: request.requestId, status: 'refused' };
    }
    return {
      requestId: request.requestId,
      ...(await advance(db, organizationId, request.requestId, actor.id)),
    };
  },
  summarize: (input) => `Request ${input.requestId}: ${input.decision}`,
});

/** Who asked corrects a request sent back to her, and sends it again (spec 075). */
export const resubmitRequest = defineCommand({
  name: 'resubmit-request',
  input: resubmitRequestInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor, organizationId }) {
    const request = await findRequest(db, input.requestId, { lock: true });
    if (!request) throw new DecisionRuleError('not_found', 'The request does not exist here.');
    if (actor.kind !== 'person' || actor.id !== request.requesterUserId) {
      throw new DecisionRuleError('not_the_requester', 'Only who asked sends it again.');
    }
    if (request.status !== 'returned') {
      throw new DecisionRuleError('not_returned', 'This request was not sent back.');
    }
    await resubmit(db, request, { title: input.title, measure: input.measure });
    return {
      requestId: request.requestId,
      ...(await advance(db, organizationId, request.requestId, actor.id)),
    };
  },
  summarize: (input) => `Request ${input.requestId}: sent again`,
});
