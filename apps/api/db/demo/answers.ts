import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

// The demo has no model: this one is written in advance (step C3). Whatever it is asked, it reads
// the demo's unpaid invoices with the assistant's own tool and says what the table shows — so that
// an answer that is a table can be seen and acted on. It proves the screens, never the quality of
// an answer; the figures are the tool's, not its own.

/** The unpaid invoices of the demo, as a team would drop them: a sheet exported in CSV. */
export const UNPAID_INVOICES = [
  'Client;Facture;Dû;Jours;Dernier contact',
  'Garage Bè;F-0412;310 000;42;relance le 9',
  'M. Kossi;F-0398;120 000;35;aucun',
  'Hôtel du Golfe;F-0421;105 000;31;promesse le 2',
  'Pharmacie Tokoin;F-0430;40 000;12;aucun',
  'Imprimerie du Port;F-0433;68 500;8;aucun',
].join('\n');

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const SAID =
  'Voici les factures impayées depuis plus de 30 jours, de la plus élevée à la plus faible. Le tableau vient du jeu de données « Factures impayées » : triez-le, filtrez-le, ou choisissez des lignes pour me dire quoi en faire.';

/** What Kete's door proposes in the demo (spec 099, cases A and B), on the demo's own project. */
export interface DemoDoor {
  projectId: string | null;
  /** The colleague who holds what is entrusted, by name. */
  colleague: string;
}

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Case A (a word from a client visit) or case B (a rule and an order), as Kete would understand them. */
function doorCalls(said: string, door: DemoDoor): { toolName: string; input: object }[] {
  if (/passe par moi/i.test(said)) {
    return [
      {
        toolName: 'propose_policy',
        input: {
          rule: 'Tout achat au-delà de 50 000 F passe par moi.',
          template: 'spending.above',
          amount: 50_000,
          approver: 'me',
        },
      },
      {
        toolName: 'propose_gestures',
        input: {
          summary: said,
          holdings: [
            {
              what: 'Préparer le planning de novembre',
              holder: door.colleague,
              due: inDays(3),
              source: 'votre message',
            },
          ],
        },
      },
    ];
  }
  if (/sors de|vocal|rendez-vous/i.test(said)) {
    return [
      {
        toolName: 'propose_gestures',
        input: {
          summary: said,
          ...(door.projectId ? { object: { kind: 'project', id: door.projectId } } : {}),
          holdings: [
            {
              what: 'Mettre à jour le devis : +2 prises, salle 3',
              holder: door.colleague,
              due: inDays(2),
              source: 'de votre message',
            },
          ],
          dates: [
            { label: 'Solde promis : 462 000 F', day: inDays(3), source: 'de votre message' },
          ],
          routines: [
            {
              title: 'Relancer le solde s’il n’est pas reçu',
              prompt: 'Le solde promis est-il reçu ? Sinon, prépare la relance.',
              cadence: 'weekdays',
              time: '18:00',
              source: 'proposé par Kete',
            },
          ],
        },
      },
    ];
  }
  return [];
}

const DOOR_SAID: Record<string, string> = {
  policy: 'Votre message contient une règle et une consigne. Je propose :',
  gestures: 'Compte rendu posté dans le fil du projet, signé par vous. Je propose trois gestes :',
};

export function scriptedAnswers(datasetId: string, door?: DemoDoor) {
  const reads = {
    type: 'tool-call' as const,
    toolCallId: 'call_demo',
    toolName: 'team_data_rows',
    input: JSON.stringify({
      datasetId,
      filters: [{ column: 'Jours', op: 'gte', value: 30 }],
      sortBy: 'Dû',
    }),
  };
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: SAID }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
    doStream: async (options) => {
      // At Kete's door, it proposes what cases A and B show, one tool after the other.
      const offeredDoor = (options.tools ?? []).some((tool) => tool.name === 'propose_gestures');
      if (door && offeredDoor) {
        const lastUser = options.prompt.findLastIndex((message) => message.role === 'user');
        const asked = options.prompt[lastUser];
        const said =
          asked && Array.isArray(asked.content)
            ? asked.content.map((part) => ('text' in part ? part.text : '')).join(' ')
            : '';
        const calls = doorCalls(said, door);
        const done = options.prompt.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
        const next = calls[done];
        if (calls.length > 0) {
          const chunks: object[] = next
            ? [
                { type: 'stream-start', warnings: [] },
                {
                  type: 'tool-call',
                  toolCallId: `call_door_${done}`,
                  toolName: next.toolName,
                  input: JSON.stringify(next.input),
                },
                {
                  type: 'finish',
                  finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                  usage,
                },
              ]
            : [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: 't1' },
                {
                  type: 'text-delta',
                  id: 't1',
                  delta: calls.some((c) => c.toolName === 'propose_policy')
                    ? DOOR_SAID.policy
                    : DOOR_SAID.gestures,
                },
                { type: 'text-end', id: 't1' },
                { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
              ];
          return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 120 }) as never };
        }
      }
      // Once its tool has answered, it says what the table shows; before, it reads.
      const read = options.prompt.at(-1)?.role === 'tool';
      const offered = (options.tools ?? []).some((tool) => tool.name === 'team_data_rows');
      const chunks: object[] =
        !read && offered
          ? [
              { type: 'stream-start', warnings: [] },
              reads,
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              ...SAID.split(/(?<= )/).map((delta) => ({ type: 'text-delta', id: 't1', delta })),
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
            ];
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 25 }) as never };
    },
  });
}

/**
 * The job description the demo proposes for any sentence (step C7): an agent that watches her
 * late decisions. Written in advance, like the answers: it shows the dry run, not a model.
 */
export function scriptedProposal() {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: 'Veille de mes décisions',
            mission: 'Me prévenir quand une décision m’attend depuis trop longtemps.',
            watches: ['decisions'],
            permissions: [],
            autonomyMax: 1,
            wakeEveryMinutes: 60,
            plan: [
              'Chaque heure, il lit les décisions qui vous attendent.',
              'Il vous prévient de celles qui ont dépassé leur délai.',
              'Il ne décide jamais à votre place.',
            ],
          }),
        },
      ],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });
}

/**
 * The evening's closure in the demo (spec 083): whatever she writes, the first task of her To do
 * is proposed as done, the second moved to the next day, and a reminder filed for the day after —
 * read from the objects the closure shows the model, never invented.
 */
export function scriptedEvening() {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const system = options.prompt.find((message) => message.role === 'system');
      const shown = typeof system?.content === 'string' ? system.content : '';
      const keys = shown.split('\n').flatMap((line) => {
        const found = /^- (tsk_\S+) \(task\) (.*?)(?:, due .*)?$/.exec(line);
        return found ? [{ key: found[1] ?? '', title: (found[2] ?? '').trim() }] : [];
      });
      const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(shown)?.[1] ?? '2026-10-14';
      const plus = (days: number) =>
        new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const [first, second] = keys;
      const items = [
        ...(first
          ? [
              {
                gesture: 'close',
                object: first.key,
                day: null,
                label: `Clore « ${first.title} »`,
                reason: 'C’est fait.',
              },
            ]
          : []),
        ...(second
          ? [
              {
                gesture: 'postpone',
                object: second.key,
                day: plus(1),
                label: `Reporter « ${second.title} » à demain`,
                reason: 'Pas eu le temps.',
              },
            ]
          : []),
        {
          gesture: 'remind',
          object: null,
          day: plus(2),
          label: 'Appeler Ecobank',
          reason: 'Rappelle-moi Ecobank.',
        },
      ];
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ items, unclear: [] }) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
}
