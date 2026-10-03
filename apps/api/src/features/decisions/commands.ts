import { defineCommand } from '@kete/commands';
import { z } from 'zod';
import { currentStep, decideRequestInput, defineCircuitInput } from './decisions.record.js';
import { mayDecide, settle, subjectsOf } from './engine.js';
import {
  decideStep,
  enterStep,
  findRequest,
  insertCircuit,
} from './infrastructure/decisions.tables.js';

/** A rule of the decisions was not met: the change is refused, nothing is written. */
export class DecisionRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'unknown_subject' | 'decided' | 'not_an_approver',
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
  async handler(input, { db, actor }) {
    const request = await findRequest(db, input.requestId, { lock: true });
    if (!request) throw new DecisionRuleError('not_found', 'The request does not exist here.');
    const step = currentStep(request);
    if (!step) throw new DecisionRuleError('decided', 'This request was already decided.');
    // A decision is a person's: an agent never decides for her (principle 3, D-039).
    if (actor.kind !== 'person' || !(await mayDecide(db, request, actor.id, input.administrator))) {
      throw new DecisionRuleError('not_an_approver', 'This step is not for this person.');
    }
    const status = input.decision === 'approve' ? 'approved' : 'refused';
    await decideStep(db, request.requestId, step.position, status, actor.id, input.reason ?? null);
    if (status === 'refused') {
      await settle(db, request, 'refused', actor.id);
      return { requestId: request.requestId, status: 'refused' };
    }
    const next = request.steps.find((s) => s.position > step.position && s.status === 'pending');
    if (next) {
      await enterStep(db, request.requestId, next.position);
      return { requestId: request.requestId, status: 'pending', step: next.position };
    }
    await settle(db, request, 'approved', actor.id);
    return { requestId: request.requestId, status: 'approved' };
  },
  summarize: (input) => `Request ${input.requestId}: ${input.decision}`,
});
