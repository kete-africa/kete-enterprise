import { extract } from '@kete/ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { organizationLanguageModel } from '../../platform/models.js';
import { usageStore } from '../../platform/usage.js';
import type { IdentityVariables } from '../../platform/identity.js';

// A routine in a sentence (spec 051): the model turns « chaque vendredi à 16 h, résume les tickets
// de la semaine » into one of the three families and its fields, with a plan in plain words —
// checked against what she may really use. Nothing is kept until she activates it.

type Identity = IdentityVariables['identity'];

export interface Choices {
  apps: { resourceId: string; name: string; emits: { type: string; description: string }[] }[];
  figures: { dashboardId: string; name: string; cards: { id: string; title: string }[] }[];
}

const understood = z.object({
  family: z.enum(['time', 'event', 'watch']),
  title: z.string().min(1).max(120),
  instruction: z.string().max(2000).nullable(),
  cadence: z.enum(['daily', 'weekdays', 'weekly']).nullable(),
  weekday: z.number().int().min(1).max(7).nullable(),
  time: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .nullable(),
  resourceId: z.string().nullable(),
  eventType: z.string().nullable(),
  dashboardId: z.string().nullable(),
  cardId: z.string().nullable(),
  direction: z.enum(['above', 'below']).nullable(),
  line: z.number().nullable(),
  plan: z.array(z.string().min(1).max(200)).min(1).max(5),
});

/** What she will activate: one family and its fields, and the plan she reads first. */
export type Proposal =
  | {
      family: 'time';
      title: string;
      prompt: string;
      cadence: 'daily' | 'weekdays' | 'weekly';
      weekday: number | null;
      time: string;
      plan: string[];
    }
  | {
      family: 'event';
      title: string;
      prompt: string;
      resourceId: string;
      app: string;
      eventType: string;
      event: string;
      plan: string[];
    }
  | {
      family: 'watch';
      title: string;
      dashboardId: string;
      cardId: string;
      figure: string;
      direction: 'above' | 'below';
      line: number;
      plan: string[];
    };

let modelOverride: LanguageModel | null | undefined;
/** Tests: understand with another model (`null`: as if none were configured). */
export function useRoutineModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

export class NoModelError extends Error {}

/** Her sentence understood, or null when it names nothing she may use. */
export async function understandRoutine(
  identity: Identity,
  sentence: string,
  choices: Choices,
): Promise<Proposal | null> {
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) throw new NoModelError();
  const apps = choices.apps
    .map(
      (a) =>
        `- app ${a.resourceId} « ${a.name} » : ${a.emits.map((e) => `${e.type} (${e.description})`).join(', ') || 'aucun évènement'}`,
    )
    .join('\n');
  const figures = choices.figures
    .map(
      (d) =>
        `- tableau ${d.dashboardId} « ${d.name} » : ${d.cards.map((c) => `${c.id} (${c.title})`).join(', ')}`,
    )
    .join('\n');
  const { value } = await extract({
    model,
    schema: understood,
    system:
      'Tu comprends une routine qu’une personne veut mettre en place, en français. Trois familles : ' +
      '« time » (à heure fixe : cadence daily, weekdays ou weekly, weekday 1 = lundi, heure HH:MM), ' +
      '« event » (quand une app signale : une app et un type d’évènement de la liste), « watch » ' +
      '(en veille : une carte chiffrée d’un tableau de la liste, au-dessus ou au-dessous d’une ' +
      'valeur). Pour time et event, instruction = ce que l’assistant doit faire. Le plan : trois à ' +
      'cinq phrases courtes — ce qui déclenche, ce que l’assistant fait, avec ses droits à elle, où ' +
      'arrive la réponse. N’utilise que des identifiants de la liste ; sinon laisse null.',
    prompt: `Phrase : « ${sentence} »\n\nApps qu’elle entend :\n${apps || '(aucune)'}\n\nChiffres qu’elle lit :\n${figures || '(aucun)'}`,
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
        purpose: 'routine-understanding',
        model: '',
      },
    },
  });
  const title = value.title.trim();
  if (value.family === 'time') {
    if (!value.cadence || !value.time || !value.instruction) return null;
    if ((value.cadence === 'weekly') !== (value.weekday !== null)) return null;
    return {
      family: 'time',
      title,
      prompt: value.instruction,
      cadence: value.cadence,
      weekday: value.cadence === 'weekly' ? value.weekday : null,
      time: value.time,
      plan: value.plan,
    };
  }
  if (value.family === 'event') {
    const app = choices.apps.find((a) => a.resourceId === value.resourceId);
    const event = app?.emits.find((e) => e.type === value.eventType);
    if (!app || !event || !value.instruction) return null;
    return {
      family: 'event',
      title,
      prompt: value.instruction,
      resourceId: app.resourceId,
      app: app.name,
      eventType: event.type,
      event: event.description,
      plan: value.plan,
    };
  }
  const board = choices.figures.find((d) => d.dashboardId === value.dashboardId);
  const card = board?.cards.find((c) => c.id === value.cardId);
  if (!board || !card || value.line === null || !value.direction) return null;
  return {
    family: 'watch',
    title,
    dashboardId: board.dashboardId,
    cardId: card.id,
    figure: `${board.name} · ${card.title}`,
    direction: value.direction,
    line: value.line,
    plan: value.plan,
  };
}
