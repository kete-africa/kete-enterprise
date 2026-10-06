import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi } from '@/platform/api';

// The governance of AI (spec 054), as the API serves it to administrators.

export interface Governance {
  since: string;
  teams: {
    unitId: string | null;
    unit: string | null;
    calls: number;
    tokens: number;
    people: number;
  }[];
  feedback: { helpful: number; judged: number };
  failures: { tasks: number; routines: number };
}
export interface JournalLine {
  at: string;
  actor: string;
  actorKind: string;
  onBehalfOf: string | null;
  channel: string;
  command: string;
  summary: string | null;
  reversible: boolean;
}

export const fetchGovernance = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest();
  const [governance, journal] = await Promise.all([
    callApi<Governance>(request, '/v1/governance'),
    callApi<{ lines: JournalLine[] }>(request, '/v1/governance/journal?limit=500'),
  ]);
  return { governance, journal: journal.lines };
});

/** The journal as a CSV file, for an auditor: one line per action, as the journal keeps it. */
export function journalCsv(lines: JournalLine[], header: string[]): string {
  const cell = (value: string | boolean | null) => {
    const text = value === null ? '' : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    header.map(cell).join(';'),
    ...lines.map((l) =>
      [l.at, l.actor, l.onBehalfOf, l.channel, l.command, l.summary, l.reversible]
        .map(cell)
        .join(';'),
    ),
  ].join('\n');
}
