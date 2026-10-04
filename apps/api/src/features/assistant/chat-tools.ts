import type { CapabilityTool } from '@kete/capabilities';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { createSchedule, scheduleInput, ScheduleLimitError } from './schedules.js';

// What the chat of the current era adds around the model (spec 027): the mentions and commands a
// person picks in the composer (assistant-ui writes them as directives in her message), the side
// canvas the assistant writes in, and the sources its tools returned.

export interface Directive {
  type: string;
  label: string;
  id: string | null;
}

const directive = /:([\w-]+)\[([^\]]+)\](?:\{name=([^}]+)\})?/g;

/** The directives of a message, and the message as a person reads it (labels only). */
export function readDirectives(text: string): { plain: string; directives: Directive[] } {
  const directives: Directive[] = [];
  const plain = text.replace(directive, (_all, type: string, label: string, id?: string) => {
    directives.push({ type, label, id: id ?? null });
    return type === 'command' ? '' : label;
  });
  return { plain: plain.replace(/\s{2,}/g, ' ').trim(), directives };
}

/** What each command asks of the assistant: model-facing instructions, not words on a screen. */
const commands: Record<string, string> = {
  summarize:
    'Résume la conversation et les pièces jointes en quelques points, les décisions et les actions à part.',
  write:
    'Rédige le document demandé dans le canevas (outil canvas_write), puis dis en une phrase ce que tu as écrit.',
  table: 'Présente la réponse sous forme de tableau.',
  explain: 'Explique simplement, comme à quelqu’un qui découvre le sujet.',
  actions:
    'Propose les actions qui en découlent, chacune avec un responsable et une échéance, en brouillons à valider.',
};

export function commandInstructions(directives: Directive[]): string[] {
  return directives
    .filter((d) => d.type === 'command' && d.id && commands[d.id])
    .map((d) => commands[d.id as string] as string);
}

const canvasInput = z.object({
  title: z.string().trim().min(1).max(160).describe('Le titre du document'),
  content: z
    .string()
    .min(1)
    .max(100_000)
    .describe('Le document entier, en Markdown : titres, listes, tableaux'),
});

/**
 * The canvas: the assistant writes a document — a letter, a report, a note — beside the
 * conversation, where the person reads, edits, copies or downloads it. Writing changes nothing
 * anywhere else (level 1).
 */
export const canvasTool: CapabilityTool = {
  name: 'canvas_write',
  description:
    'Écrit ou réécrit un document dans le canevas, à côté de la conversation : lettre, compte rendu, note, procédure. Donne le document entier à chaque fois.',
  input: canvasInput,
  jsonSchema: z.toJSONSchema(canvasInput) as Record<string, unknown>,
  autonomy: 1,
  async execute(input) {
    const value = canvasInput.parse(input);
    return { status: 'done', output: { title: value.title, content: value.content } };
  },
};

const scheduleToolInput = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('Un titre court, par exemple « Actions en retard de mon équipe ».'),
  kind: z
    .enum(['briefing', 'prompt'])
    .describe('briefing : son briefing du matin ; prompt : une question à laquelle répondre.'),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe('La question, pour une tâche « prompt ».'),
  cadence: z.enum(['daily', 'weekdays', 'weekly']),
  weekday: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe('1 = lundi … 7 = dimanche, si weekly.'),
  time: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .describe('HH:MM, son heure locale.'),
  byEmail: z.boolean().optional().describe('Aussi par e-mail, si elle le demande.'),
});

/**
 * Schedules a task of hers from the chat (spec 029): « every Monday at 8, the late actions of my
 * team ». It sets only her own tasks, which she sees, pauses or removes in her assistant (level 2).
 */
export function scheduleTool(person: {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
}): CapabilityTool {
  return {
    name: 'schedule_task',
    description:
      'Planifie une tâche pour elle : son briefing du matin, ou une question à laquelle tu répondras à heure fixe (chaque jour, en semaine ou un jour de la semaine). La réponse arrivera dans son « À faire ».',
    input: scheduleToolInput,
    jsonSchema: z.toJSONSchema(scheduleToolInput) as Record<string, unknown>,
    autonomy: 2,
    async execute(input) {
      const parsed = scheduleInput.safeParse(input);
      if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
      try {
        const schedule = await transaction(person.organizationId, (db) =>
          createSchedule(db, person, parsed.data),
        );
        return {
          status: 'done',
          output: {
            title: schedule.title,
            nextRunAt: schedule.nextRunAt,
            href: '/assistant/taches',
          },
        };
      } catch (error) {
        if (error instanceof ScheduleLimitError)
          return { status: 'refused', reason: 'not_allowed' };
        throw error;
      }
    },
  };
}

export interface Source {
  label: string;
  href: string;
}

/**
 * The sources a tool's output names: every object with a label (title, name) and an address
 * (href, url, address) — a record of an app, a document. At most five per answer.
 */
export function sourcesOf(output: unknown, found: Source[] = [], depth = 0): Source[] {
  if (depth > 5 || found.length >= 5 || output === null || typeof output !== 'object') {
    return found;
  }
  if (Array.isArray(output)) {
    for (const item of output) sourcesOf(item, found, depth + 1);
    return found;
  }
  const record = output as Record<string, unknown>;
  const label = [record.title, record.name, record.label].find((v) => typeof v === 'string');
  const href = [record.href, record.url, record.address].find(
    (v) => typeof v === 'string' && /^(https:\/\/|\/)/.test(v),
  );
  if (typeof label === 'string' && typeof href === 'string') {
    if (!found.some((s) => s.href === href)) found.push({ label: label.slice(0, 120), href });
  }
  for (const value of Object.values(record)) sourcesOf(value, found, depth + 1);
  return found;
}
