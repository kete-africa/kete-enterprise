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

export function scriptedAnswers(datasetId: string) {
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
