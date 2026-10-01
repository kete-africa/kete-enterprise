import { defineCommand } from '@kete/commands';
import { z } from 'zod';
import { openRequest } from '../decisions/index.js';
import {
  decide,
  findPromotion,
  findResource,
  insertPromotion,
  insertResource,
  linkRequest,
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
  type IdentityCard,
} from './registry.record.js';

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

/** The card the API read itself; a caller never supplies it. */
const card = z.custom<IdentityCard | null>((value) => value === null || typeof value === 'object');

export const registerResource = defineCommand({
  name: 'register-resource',
  input: registerInput.extend({ ownerName: z.string().min(1).max(160), card }),
  reversibility: { reversible: true, inverse: 'retire-resource' },
  handler: (input, { db, organizationId, actor }) =>
    insertResource(db, organizationId, {
      ...input,
      ownerUserId: actor.onBehalfOf?.id ?? actor.id,
      risk: riskOf(input.card),
    }),
  summarize: (input) => `${input.kind} "${input.name}" registered in its owner's space`,
});

export const refreshIdentityCard = defineCommand({
  name: 'refresh-identity-card',
  input: z.object({ resourceId, card }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    if (!(await findResource(db, input.resourceId))) {
      throw new RegistryRuleError('not_found', 'The resource does not exist here.');
    }
    const risk = riskOf(input.card);
    await setCard(db, input.resourceId, input.card, risk);
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
