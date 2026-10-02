import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { readRegister } from '../actions/index.js';
import { inboxFor } from '../decisions/index.js';
import { listMeetings, listNotes } from '../meetings/index.js';
import { readModules } from '../organization/index.js';
import { listReviews } from '../performance/index.js';
import { registryFor } from '../registry/index.js';
import { personOfAccount } from '../structure/index.js';
import { respondentsOfPerson } from '../surveys/index.js';

/**
 * What waits for a person and where she stands, read from the registers with her rights (spec 014):
 * the home page shows it, the morning briefing tells it, the assistant answers from it. Nothing
 * here is about pay: its data never reaches a model.
 */
export interface Facts {
  name: string;
  today: string;
  forms: { title: string; period: string; closesOn: string; done: number; total: number }[];
  decisions: { title: string; overdue: boolean }[];
  actions: { title: string; dueOn: string; overdue: boolean; source: string }[];
  notes: { number: string | null; subject: string }[];
  performance: {
    position: string;
    status: string;
    factor: number | null;
    reds: string[];
    oranges: string[];
  }[];
  team: { name: string; status: string; reds: number; factor: number | null }[];
  meetings: { title: string; when: string; decisions: string[] }[];
  apps: { name: string; address: string | null; kind: string }[];
}

export async function factsFor(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role' | 'name'>,
): Promise<Facts> {
  const today = new Date().toISOString().slice(0, 10);
  const modules = await readModules(db);
  const person = await personOfAccount(db, identity.userId);
  const personId = person?.personId ?? null;
  const inbox = await inboxFor(db, identity);
  const registry = await registryFor(db, identity);
  const facts: Facts = {
    name: person?.name ?? identity.name,
    today,
    forms: [],
    decisions: inbox.toDecide.map((r) => ({ title: r.title, overdue: r.overdue })),
    actions: [],
    notes: [],
    performance: [],
    team: [],
    meetings: [],
    apps: registry.resources
      .filter((r) => r.status === 'active' && (r.kind === 'app' || r.kind === 'mcp'))
      .map((r) => ({ name: r.name, address: r.address ?? null, kind: r.kind })),
  };
  if (!personId) return facts;
  facts.actions = (await readRegister(db, { personId, openOnly: true })).map((a) => ({
    title: a.title,
    dueOn: a.dueOn,
    overdue: a.overdue,
    source: a.source,
  }));
  if (modules.surveys) {
    facts.forms = (await respondentsOfPerson(db, personId))
      .filter((r) => r.status !== 'submitted')
      .map((r) => ({
        title: r.title,
        period: r.period,
        closesOn: r.closesOn,
        done: r.formsSubmitted,
        total: r.formsTotal,
      }));
  }
  if (modules.meetings) {
    facts.notes = (await listNotes(db, personId))
      .filter((n) => n.status === 'published' && !n.readByMe)
      .map((n) => ({ number: n.number, subject: n.subject }));
    facts.meetings = (await listMeetings(db))
      .filter((m) => m.status === 'recorded')
      .slice(0, 3)
      .map((m) => ({
        title: m.title,
        when: m.startsAt.slice(0, 10),
        decisions: m.decisions.map((d) => d.text),
      }));
  }
  if (modules.performance) {
    facts.performance = (await listReviews(db, { personId }, true)).slice(0, 2).map((r) => ({
      position: r.positionTitle,
      status: r.status,
      factor: r.factor,
      reds: r.lines.filter((l) => l.colour === 'red').map((l) => l.name),
      oranges: r.lines.filter((l) => l.colour === 'orange').map((l) => l.name),
    }));
    facts.team = (await listReviews(db, { managerPersonId: personId }, true)).map((r) => ({
      name: r.personName,
      status: r.status,
      reds: r.lines.filter((l) => l.colour === 'red').length,
      factor: r.factor,
    }));
  }
  return facts;
}
