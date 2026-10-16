import type { Policy } from '@kete/sdk';
import { policyWords } from './words.js';

// The center's policy schema (spec 088, kete-core spec 112), in Cedar's text form. Who acts — a
// person in her roles and units, with her manager, her deputy and whether she is away today; an
// agent with the person it works for and its autonomy — on what, with which context. The rights
// stay what they are (D-058): a policy reads a role as `principal in Kete::Role::"rol_…"`.
//
// A context attribute an app may not know is optional: a policy reads it with `has`.

export const NAMESPACE = 'Kete';

export const centerSchema = `
namespace Kete {
  entity Role;
  entity Unit in [Unit];
  entity Person in [Role, Unit] { absent: Bool, manager?: Person, deputy?: Person };
  entity Agent { onBehalfOf: Person, autonomyMax: Long };
  entity Capability;
  entity Subject;
  entity Project { holder?: Person };
  entity Party;
  entity Document;
  entity Card { holder: Person };

  action "capability.use" appliesTo { principal: [Person, Agent], resource: Capability,
    context: { permission: String, autonomy: Long } };
  action "request.open" appliesTo { principal: [Person, Agent], resource: Subject,
    context: { measure?: Long } };
  action "contract.sign" appliesTo { principal: [Person, Agent], resource: Project,
    context: { amount: Long } };
  action "purchase.commit" appliesTo { principal: [Person, Agent], resource: Project,
    context: { amount: Long, budgetLeft?: Long } };
  action "message.client" appliesTo { principal: [Person, Agent], resource: Party,
    context: { channel: String, hour: Long, approvedTemplate?: Bool, consent?: Bool,
      optedOut?: Bool } };
  action "document.read" appliesTo { principal: [Person, Agent], resource: Document,
    context: { confidential?: Bool, reader?: Bool } };
  action "document.delete" appliesTo { principal: [Person, Agent], resource: Document,
    context: { ageDays: Long, retentionDays?: Long } };
  action "card.decide" appliesTo { principal: [Person, Agent], resource: Card, context: {} };
}`;

/** The gestures the center knows: any other is refused before the engine (FR-006). */
export const knownGestures = [
  'capability.use',
  'request.open',
  'contract.sign',
  'purchase.commit',
  'message.client',
  'document.read',
  'document.delete',
  'card.decide',
] as const;
export type GestureKind = (typeof knownGestures)[number];

/** What a gesture's object must be, for each gesture the center knows. */
export const objectOf: Record<GestureKind, string> = {
  'capability.use': 'capability',
  'request.open': 'subject',
  'contract.sign': 'project',
  'purchase.commit': 'project',
  'message.client': 'party',
  'document.read': 'document',
  'document.delete': 'document',
  'card.decide': 'card',
};

const base = (id: string, sentence: string, rule: string): Policy => ({
  id,
  version: 1,
  sentence,
  rule,
  set: 'authority',
  owner: 'kete',
  status: 'active',
});

/**
 * Kete's own policies, the same in every organization and never stored: what the center allowed
 * before any policy was written. A tool an agent was given may be used and a request opened — the
 * organization's policies then forbid or ask. The other gestures need the organization's own
 * permits: nothing is allowed that nobody allowed.
 */
export const basePolicies: readonly Policy[] = [
  base(
    'kete.capabilities',
    policyWords().baseCapabilities,
    `permit (principal, action == Kete::Action::"capability.use", resource);`,
  ),
  base(
    'kete.requests',
    policyWords().baseRequests,
    `permit (principal, action == Kete::Action::"request.open", resource);`,
  ),
];
