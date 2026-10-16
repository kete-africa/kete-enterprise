import type { DatedFact } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import type { Holder, Structure } from '@kete/work';
import { holdersAt, reportingLines } from '../structure/index.js';
import { factsBetween } from '../time/index.js';

// Who stands in for whom in the center (spec 087, FR-002), by account: the delegate she named in
// « Mon accueil » while she is away, her manager in the structure, the organization's head (who
// holds a position reporting to none). Absences come from « Mon accueil » and Planifier.

export interface CenterStructure {
  structure: Structure;
  head: string | null;
  absences: DatedFact[];
  /** Whether a holder is still there: a person with a position today, an agent not removed. */
  isActive(holder: Holder): boolean;
  /** Whom an agent works for. */
  personOfAgent(agentId: string): string | null;
  /** A person's name, for what she is told. */
  nameOf(userId: string): string;
}

export async function centerStructure(db: SqlExecutor, now = new Date()): Promise<CenterStructure> {
  const today = now.toISOString().slice(0, 10);
  const { rows: people } = await db.query<{
    person_id: string;
    account_user_id: string | null;
    name: string;
  }>(`select person_id, account_user_id, name from people`);
  const accountOf = new Map(people.map((p) => [p.person_id, p.account_user_id ?? p.person_id]));
  const personOf = new Map(
    people.filter((p) => p.account_user_id).map((p) => [p.account_user_id as string, p.person_id]),
  );
  const names = new Map(people.map((p) => [p.account_user_id ?? p.person_id, p.name]));

  const holders = await holdersAt(db, today);
  const lines = await reportingLines(db, today);
  const placed = new Set(holders.flatMap((h) => (h.personId ? [h.personId] : [])));
  const roots = holders
    .filter((h) => h.reportsTo === null && h.personId)
    .map((h) => accountOf.get(h.personId as string) ?? (h.personId as string))
    .sort();
  const head = roots[0] ?? null;

  const { rows: away } = await db.query<{
    user_id: string;
    starts_on: string;
    ends_on: string;
    delegate_user_id: string;
  }>(
    `select user_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on,
            to_char(ends_on, 'YYYY-MM-DD') as ends_on, delegate_user_id
       from reception_absences where ends_on >= $1::date`,
    [today],
  );
  const delegates = new Map(
    away.filter((a) => a.starts_on <= today).map((a) => [a.user_id, a.delegate_user_id]),
  );
  const planned = (await factsBetween(db, today, today)).filter((f) => f.kind === 'absence');
  const fromReception = away.map((a): DatedFact => ({
    key: `reception:${a.user_id}`,
    kind: 'absence' as const,
    label: 'absence',
    day: a.starts_on,
    until: a.ends_on,
    person_ids: [a.user_id],
  }));
  const absences: DatedFact[] = [...fromReception, ...planned];

  const { rows: agents } = await db.query<{
    agent_id: string;
    responsible_user_id: string | null;
  }>(`select agent_id, responsible_user_id from agents`);
  const agentOf = new Map(agents.map((a) => [a.agent_id, a]));

  return {
    head,
    absences,
    structure: {
      deputyOf: (userId) => delegates.get(userId) ?? null,
      managerOf: (userId) => {
        const personId = personOf.get(userId) ?? userId;
        const manager = lines.managersOf(personId).sort()[0];
        return manager ? (accountOf.get(manager) ?? manager) : null;
      },
      head,
    },
    isActive: (holder) => {
      // An agent paused is still there; one removed is not.
      if (holder.kind === 'agent') return agentOf.has(holder.id);
      // A person known to the structure is there while she holds a position; an account the
      // structure does not know (an administrator) is taken as there.
      const personId = personOf.get(holder.id) ?? (accountOf.has(holder.id) ? holder.id : null);
      return personId === null || placed.has(personId);
    },
    personOfAgent: (agentId) => agentOf.get(agentId)?.responsible_user_id ?? null,
    nameOf: (userId) => names.get(userId) ?? userId,
  };
}
