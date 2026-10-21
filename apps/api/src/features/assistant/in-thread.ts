import { ask, BudgetExceededError } from '@kete/ai';
import { asPerson } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { toolsForPerson } from '../gateway/index.js';
import { meteringStore, modelFor, organizationName, purposeOf, system } from './assistant.js';

// Kete in every thread (spec 098, FR-012, FR-013): asked by « @Kete » or « Créer… », the assistant
// reads the thread and its object's state, answers with the person's capabilities — never more
// rights than hers —, and what commits comes as a draft she decides.

type Identity = IdentityVariables['identity'];

/** Her question in a thread, answered with her rights; else why not: no model, or it failed. */
export async function answerInThread(
  identity: Identity,
  input: { thread: string; context: string; question: string },
): Promise<{ text: string } | { failure: 'no_model' | 'failed' }> {
  const choice = await modelFor(identity);
  if (!choice) return { failure: 'no_model' };
  const organization = await transaction(identity.organizationId, (db) => organizationName(db));
  try {
    const answer = await asPerson(identity, async () =>
      ask({
        model: choice.model,
        system: [
          system(organization, identity.name),
          `Tu réponds dans le fil « ${input.thread} », lu par ses membres : sois bref, une réponse de fil, pas un rapport.`,
          'Ce qui engage (une dépense, un devis, un ticket, une demande) se prépare en brouillon : dis-le, elle le valide.',
          `Le fil et l’état de son objet :\n${input.context}`,
        ].join('\n'),
        prompt: input.question,
        tools: await toolsForPerson(identity),
        maxSteps: 6,
        metering: {
          store: meteringStore(choice.personal),
          context: {
            organizationId: identity.organizationId,
            actor: {
              kind: 'agent',
              id: 'agt_assistant',
              channel: 'chat',
              onBehalfOf: { kind: 'person', id: identity.userId },
            },
            purpose: purposeOf('thread', choice.personal),
            model: '',
          },
        },
      }),
    );
    const text = answer.text.trim();
    return text ? { text } : { failure: 'failed' };
  } catch (error) {
    if (error instanceof BudgetExceededError) return { failure: 'no_model' };
    console.error('[thread]', (error as Error).message);
    return { failure: 'failed' };
  }
}
