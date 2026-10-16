import { extract } from '@kete/ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { organizationLanguageModel } from '../../platform/models.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { usageStore } from '../../platform/usage.js';
import { engine } from './policies.js';
import { centerSchema } from './schema.js';

// A policy in a sentence (spec 088, FR-005; kete-core spec 112, FR-002): the model proposes the
// Cedar rule of what an administrator wrote, checked against the center's schema. Nothing is kept:
// a person reads it, corrects it if need be, and saves it — on trial.

type Identity = IdentityVariables['identity'];

let modelOverride: LanguageModel | null | undefined;
/** Tests: propose with another model (`null`: as if none were configured). */
export function useProposalModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

export class NoModelError extends Error {}

const proposed = z.object({
  set: z.enum(['authority', 'approval']),
  approver: z.string().max(80).nullable(),
  rule: z.string().min(1).max(4000),
  explanation: z.string().min(1).max(500),
});

export interface Proposal {
  set: 'authority' | 'approval';
  approver: string | null;
  rule: string;
  explanation: string;
  /** Whether the rule fits the schema, and why not. */
  check: { ok: boolean; errors: string[] };
}

export async function proposePolicy(
  identity: Identity,
  sentence: string,
  roles: { roleId: string; name: string }[],
): Promise<Proposal> {
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) throw new NoModelError();
  const { value } = await extract({
    model,
    schema: proposed,
    system:
      'Tu écris une politique Cedar (une seule : un permit ou un forbid) pour le schéma donné, à ' +
      'partir de la phrase d’un administrateur. Deux ensembles : « authority » (ce qui est permis ' +
      'ou interdit : un forbid refuse, rien de permis refuse) et « approval » (un permit qui ' +
      'correspond demande l’accord d’un approbateur). Approbateurs possibles : manager, ' +
      'on_behalf_of, project.holder, role:<id>, position:<id>, person:<id> ; null pour authority. ' +
      'Un rôle se lit `principal in Kete::Role::"<id>"` ; la personne d’un agent ' +
      '`principal.onBehalfOf`. Un attribut de contexte optionnel se lit avec `has`. Explique en ' +
      'une phrase ce que fait la règle.',
    prompt: `Schéma :\n${centerSchema}\n\nRôles :\n${
      roles.map((r) => `- ${r.roleId} « ${r.name} »`).join('\n') || '(aucun)'
    }\n\nPhrase : « ${sentence} »`,
    metering: {
      store: usageStore(),
      context: {
        organizationId: identity.organizationId,
        actor: {
          kind: 'agent',
          id: 'agt_assistant',
          channel: 'web',
          onBehalfOf: { kind: 'person', id: identity.userId },
        },
        purpose: 'policy-proposal',
        model: '',
      },
    },
  });
  return {
    set: value.set,
    approver: value.set === 'approval' ? (value.approver ?? 'manager') : null,
    rule: value.rule,
    explanation: value.explanation,
    check: engine.check(value.rule),
  };
}
