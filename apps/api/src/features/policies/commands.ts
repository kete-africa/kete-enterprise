import { defineCommand } from '@kete/commands';
import { currentPolicies, policyVersions, PolicyError, savePolicy } from '@kete/policies';
import { z } from 'zod';
import { engine } from './policies.js';

/** A rule of the policies was not met: the change is refused, nothing is written. */
export class PolicyRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'reserved' | 'not_observed' | 'invalid_rule',
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'PolicyRuleError';
  }
}

/** Kete's own, the circuits' and the rules' policies are written through their own doors. */
const reserved = /^(kete\.|circuit\.|rul_)/;

/** Who approves: a relation, or a role, position or person of the structure. */
export const approver = z
  .string()
  .regex(
    /^(manager|on_behalf_of|project\.holder|(role|position|person):[a-z]{3}_[0-9a-f-]{8,64})$/,
  );

export const savePolicyInput = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/)
      .max(80),
    sentence: z.string().trim().min(3).max(500),
    rule: z.string().trim().min(1).max(4000),
    set: z.enum(['authority', 'approval']),
    approver: approver.optional(),
  })
  .refine((p) => (p.set === 'approval') === (p.approver !== undefined), {
    message: 'An approval names its approver; an authority none.',
  });

/**
 * A policy written by an administrator (FR-005): its rule must fit the center's schema; it is a
 * new version, and every version is born on trial — observed before it is applied (D-058).
 */
export const savePolicyCommand = defineCommand({
  name: 'save-policy',
  input: savePolicyInput,
  reversibility: { reversible: true, inverse: 'set-policy-status' },
  async handler(input, { db, organizationId, actor }) {
    if (reserved.test(input.id)) {
      throw new PolicyRuleError('reserved', 'This policy is written through its own door.');
    }
    try {
      return await savePolicy(db, organizationId, engine, {
        id: input.id,
        sentence: input.sentence,
        rule: input.rule,
        set: input.set,
        ...(input.approver ? { approver: input.approver } : {}),
        owner: actor.id,
        status: 'trial',
        writtenBy: actor.id,
      });
    } catch (error) {
      if (error instanceof PolicyError && error.code === 'invalid_rule') {
        throw new PolicyRuleError('invalid_rule', error.message, error.issues);
      }
      throw error;
    }
  },
  summarize: (input) => `Policy on trial: ${input.sentence}`,
});

export const policyStatusInput = z.object({
  policyId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/)
    .max(80),
  status: z.enum(['active', 'trial', 'off']),
});

/**
 * A policy switched on — only once its rule was observed on trial — put back on trial, or off:
 * a new version. A rule of the agents is switched through `/v1/rules`, once tried on the month.
 */
export const setPolicyStatus = defineCommand({
  name: 'set-policy-status',
  input: policyStatusInput,
  reversibility: { reversible: true, inverse: 'set-policy-status' },
  async handler(input, { db, organizationId, actor }) {
    if (input.policyId.startsWith('rul_') || input.policyId.startsWith('kete.')) {
      throw new PolicyRuleError('reserved', 'This policy is switched through its own door.');
    }
    const policy = (await currentPolicies(db)).find((p) => p.id === input.policyId);
    if (!policy) throw new PolicyRuleError('not_found', 'No such policy here.');
    if (input.status === 'active') {
      const versions = await policyVersions(db, input.policyId);
      const observed = versions.some((v) => v.status === 'trial' && v.rule === policy.rule);
      // A circuit's policy applies from its definition: it was never on trial.
      if (!observed && !input.policyId.startsWith('circuit.')) {
        throw new PolicyRuleError('not_observed', 'Observe it on trial before switching it on.');
      }
    }
    const saved = await savePolicy(db, organizationId, engine, {
      id: policy.id,
      sentence: policy.sentence,
      rule: policy.rule,
      set: policy.set,
      ...(policy.approver ? { approver: policy.approver } : {}),
      owner: policy.owner,
      status: input.status,
      writtenBy: actor.id,
    });
    return { policy: saved, before: policy.status };
  },
  summarize: (input, output) => `Policy ${input.status}: ${output.policy.sentence}`,
});
