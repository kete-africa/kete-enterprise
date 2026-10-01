import { defineCommand } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { openRequest } from '../decisions/index.js';
import {
  decide,
  findPromotion,
  findResource,
  insertPromotion,
  insertResource,
  linkRequest,
  nameOf,
  retire,
  setCard,
  setTier,
} from './infrastructure/registry.tables.js';
import {
  decidePromotionInput,
  registerInput,
  requestPromotionInput,
  resourceId,
  retireInput,
  riskLevel,
  riskOf,
} from './registry.record.js';
import { readCard } from './infrastructure/identity-card.js';

/** A rule of the registry was not met: the change is refused, nothing is written. */
export class RegistryRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'retired' | 'already_pending' | 'decided' | 'own_request',
    message: string,
  ) {
    super(message);
    this.name = 'RegistryRuleError';
  }
}

export const registerResource = defineCommand({
  name: 'register-resource',
  // The owner's name, when the screen knows it; otherwise the person of the structure.
  input: registerInput.extend({ ownerName: z.string().min(1).max(160).optional() }),
  reversibility: { reversible: true, inverse: 'retire-resource' },
  async handler(input, { db, organizationId, actor }) {
    const ownerUserId = actor.onBehalfOf?.id ?? actor.id;
    // The API reads an app's card itself: a caller, a person or an agent, never supplies it.
    const card = input.address ? await readCard(input.address) : null;
    return insertResource(db, organizationId, {
      ...input,
      ownerUserId,
      ownerName: input.ownerName ?? (await nameOf(db, ownerUserId)) ?? ownerUserId,
      card,
      risk: riskOf(card),
    });
  },
  summarize: (input) => `${input.kind} "${input.name}" registered in its owner's space`,
});

/** The same registration for an agent acting for a person: her name comes from the structure. */
export const registerResourceForAgent = defineCommand({
  ...registerResource,
  input: registerInput,
  handler: (input, context) => registerResource.handler(input, context),
});

export const refreshIdentityCard = defineCommand({
  name: 'refresh-identity-card',
  input: z.object({ resourceId }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const resource = await findResource(db, input.resourceId);
    if (!resource) throw new RegistryRuleError('not_found', 'The resource does not exist here.');
    const card = resource.address ? await readCard(resource.address) : null;
    const risk = riskOf(card);
    await setCard(db, input.resourceId, card, risk);
    return { resourceId: input.resourceId, risk };
  },
  summarize: (input) => `Identity card of ${input.resourceId} read again`,
});

export const requestPromotion = defineCommand({
  name: 'request-promotion',
  input: requestPromotionInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const resource = await findResource(db, input.resourceId);
    if (!resource) throw new RegistryRuleError('not_found', 'The resource does not exist here.');
    if (resource.status === 'retired') {
      throw new RegistryRuleError('retired', 'A retired resource is not promoted.');
    }
    const requestedBy = actor.onBehalfOf?.id ?? actor.id;
    try {
      const promotion = await insertPromotion(db, organizationId, {
        resourceId: input.resourceId,
        target: input.target,
        requestedBy,
      });
      // With an approval circuit for promotions, it decides; its measure is the resource's risk.
      const requestId = await openRequest(db, organizationId, {
        subject: 'registry.promotion',
        reference: promotion.promotionId,
        title: resource.name,
        requesterUserId: requestedBy,
        unitId: input.target.kind === 'unit' ? input.target.unitId : null,
        measure: riskLevel(resource.risk),
      });
      if (requestId) await linkRequest(db, promotion.promotionId, requestId);
      return { ...promotion, decisionRequestId: requestId };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        throw new RegistryRuleError('already_pending', 'A promotion of it is already waiting.');
      }
      if (code === '23503') throw new RegistryRuleError('not_found', 'That unit does not exist.');
      throw error;
    }
  },
  summarize: (input) =>
    `Promotion of ${input.resourceId} to ${input.target.kind === 'unit' ? input.target.unitId : 'the organization'} requested`,
});

export const decidePromotion = defineCommand({
  name: 'decide-promotion',
  input: decidePromotionInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const promotion = await findPromotion(db, input.promotionId);
    if (!promotion) throw new RegistryRuleError('not_found', 'The promotion does not exist here.');
    if (promotion.status !== 'pending') {
      throw new RegistryRuleError('decided', 'This promotion was already decided.');
    }
    // A person never approves her own request: a review needs another pair of eyes.
    if (promotion.requestedBy === actor.id) {
      throw new RegistryRuleError('own_request', 'A person does not decide her own request.');
    }
    const status = input.decision === 'approve' ? 'approved' : 'refused';
    await decide(db, input.promotionId, status, actor.id, input.reason ?? null);
    if (status === 'approved') await setTier(db, promotion.resourceId, promotion.target);
    return { promotionId: input.promotionId, status };
  },
  summarize: (input) => `Promotion ${input.promotionId}: ${input.decision}`,
});

export const retireResource = defineCommand({
  name: 'retire-resource',
  input: retireInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    if (!(await findResource(db, input.resourceId))) {
      throw new RegistryRuleError('not_found', 'The resource does not exist here.');
    }
    await retire(db, input.resourceId);
    return { resourceId: input.resourceId, status: 'retired' };
  },
  summarize: (input) => `Resource ${input.resourceId} retired`,
});

/** An agent enters the registry when it is created, in its responsible person's space (spec 007). */
export async function registerAgent(
  db: SqlExecutor,
  organizationId: string,
  agent: { name: string; mission: string; ownerUserId: string },
): Promise<string> {
  const resource = await insertResource(db, organizationId, {
    kind: 'agent',
    name: agent.name,
    description: agent.mission,
    ownerUserId: agent.ownerUserId,
    ownerName: (await nameOf(db, agent.ownerUserId)) ?? agent.ownerUserId,
    card: null,
    risk: 'unknown',
  });
  return resource.resourceId;
}
