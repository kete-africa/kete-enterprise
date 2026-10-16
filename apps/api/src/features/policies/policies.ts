import {
  createPolicyEngine,
  currentPolicies,
  decideGesture,
  savePolicy,
  type Entity,
  type JournaledDecision,
  type PolicyEngine,
} from '@kete/policies';
import type { Gesture } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { awayOn } from '@kete/work';
import { transaction } from '../../platform/db.js';
import { approversOf } from '../decisions/index.js';
import { centerStructure } from '../work/index.js';
import {
  basePolicies,
  centerSchema,
  knownGestures,
  NAMESPACE,
  objectOf,
  type GestureKind,
} from './schema.js';
import { policyWords } from './words.js';

// The center's policy engine (spec 088, doctrine D-058): one engine at the gesture, the same for
// a person and for her agent. A gesture is read with the entities it touches, drawn from the
// center's own records today — her roles and units, her manager, her deputy, whether she is away;
// the person an agent works for and its autonomy; a project's lead; a card's holder — decided
// under Kete's base policies and the organization's, and journaled.

const raw = createPolicyEngine({ schema: centerSchema, namespace: NAMESPACE });

/** The engine, with Kete's base policies read before the organization's. */
export const engine: PolicyEngine = {
  ...raw,
  decide: (input) => raw.decide({ ...input, policies: [...basePolicies, ...input.policies] }),
};

/** A gesture the center cannot decide: unknown, or its object is not what it acts on. */
export class GestureError extends Error {
  constructor(
    readonly code: 'unknown_gesture' | 'wrong_object' | 'agent_for_nobody',
    message: string,
  ) {
    super(message);
    this.name = 'GestureError';
  }
}

const uid = (type: string, id: string) => ({ type: `${NAMESPACE}::${type}`, id });
const ref = (type: string, id: string) => ({ __entity: uid(type, id) });

const ACTIVE = (alias: string) =>
  `${alias}.starts_on <= current_date and (${alias}.ends_on is null or ${alias}.ends_on >= current_date)`;

/** The roles a person holds today (by her positions or in her own name), and her units. */
async function placeOf(db: SqlExecutor, userId: string) {
  const { rows: roles } = await db.query<{ role_id: string }>(
    `select distinct g.role_id from role_grants g
       join people pe on pe.account_user_id = $1
      where ${ACTIVE('g')}
        and (g.person_id = pe.person_id
             or g.position_id in (select a.position_id from assignments a
                                   where a.person_id = pe.person_id and ${ACTIVE('a')}))`,
    [userId],
  );
  const { rows: units } = await db.query<{ unit_id: string; primary: boolean }>(
    `select distinct p.unit_id, a.kind = 'primary' as primary from assignments a
       join people pe on pe.person_id = a.person_id
       join positions p on p.position_id = a.position_id
      where pe.account_user_id = $1 and ${ACTIVE('a')}`,
    [userId],
  );
  return {
    roles: roles.map((r) => r.role_id),
    units: units.map((u) => u.unit_id),
    primaryUnit: units.find((u) => u.primary)?.unit_id ?? units[0]?.unit_id ?? null,
  };
}

/** Who the gesture is for, as a person: herself, or the person her agent works for. */
export async function personBehind(db: SqlExecutor, actor: Gesture['actor']): Promise<string> {
  if (actor.kind === 'person') return actor.id;
  if (actor.on_behalf_of) return actor.on_behalf_of;
  const { rows } = await db.query<{ responsible_user_id: string | null }>(
    `select responsible_user_id from agents where agent_id = $1`,
    [actor.id],
  );
  const person = rows[0]?.responsible_user_id;
  if (!person) throw new GestureError('agent_for_nobody', 'This agent works for nobody.');
  return person;
}

/** The entities a gesture touches, read from the center's records today. */
export async function entitiesFor(db: SqlExecutor, gesture: Gesture): Promise<Entity[]> {
  const structure = await centerStructure(db, new Date(gesture.at));
  const today = gesture.at.slice(0, 10);
  const people = new Map<string, Entity>();
  const person = async (userId: string) => {
    if (people.has(userId)) return;
    const place = await placeOf(db, userId);
    const manager = structure.structure.managerOf(userId);
    const deputy = structure.structure.deputyOf(userId);
    people.set(userId, {
      uid: uid('Person', userId),
      attrs: {
        absent: awayOn(structure.absences, userId, today),
        ...(manager ? { manager: ref('Person', manager) } : {}),
        ...(deputy ? { deputy: ref('Person', deputy) } : {}),
      },
      parents: [
        ...place.roles.map((role) => uid('Role', role)),
        ...place.units.map((unit) => uid('Unit', unit)),
      ],
    });
  };

  const others: Entity[] = [];
  const behind = await personBehind(db, gesture.actor);
  await person(behind);
  if (gesture.actor.kind === 'agent') {
    const { rows } = await db.query<{ autonomy_max: number }>(
      `select autonomy_max from agents where agent_id = $1`,
      [gesture.actor.id],
    );
    others.push({
      uid: uid('Agent', gesture.actor.id),
      // The assistant and a copilot through the gateway are no agent of the table: they read.
      attrs: { onBehalfOf: ref('Person', behind), autonomyMax: rows[0]?.autonomy_max ?? 1 },
      parents: [],
    });
  }

  if (gesture.object.kind === 'project') {
    const { rows } = await db.query<{ lead_user_id: string | null }>(
      `select lead_user_id from projects where project_id = $1`,
      [gesture.object.id],
    );
    const lead = rows[0]?.lead_user_id;
    if (lead) await person(lead);
    others.push({
      uid: uid('Project', gesture.object.id),
      attrs: lead ? { holder: ref('Person', lead) } : {},
      parents: [],
    });
  }
  if (gesture.object.kind === 'card') {
    const { rows } = await db.query<{ holder_kind: string; holder_id: string }>(
      `select holder_kind, holder_id from kete_holdings where holding_id = $1`,
      [gesture.object.id],
    );
    const held = rows[0];
    const holder = !held
      ? null
      : held.holder_kind === 'agent'
        ? structure.personOfAgent(held.holder_id)
        : held.holder_id;
    if (holder) {
      await person(holder);
      others.push({
        uid: uid('Card', gesture.object.id),
        attrs: { holder: ref('Person', holder) },
        parents: [],
      });
    }
  }

  // The units above hers, so a policy may name a unit and reach those under it.
  const { rows: units } = await db.query<{ unit_id: string; parent_id: string | null }>(
    `select unit_id, parent_id from units`,
  );
  return [
    ...people.values(),
    ...others,
    ...units.map((u) => ({
      uid: uid('Unit', u.unit_id),
      attrs: {},
      parents: u.parent_id ? [uid('Unit', u.parent_id)] : [],
    })),
  ];
}

/** The gesture's context, completed with what the center knows: the hour of a message. */
function completed(gesture: Gesture): Gesture {
  if (gesture.kind !== 'message.client' || gesture.context?.hour !== undefined) return gesture;
  return { ...gesture, context: { ...gesture.context, hour: new Date(gesture.at).getUTCHours() } };
}

/**
 * Decides a gesture under Kete's base policies and the organization's, and journals it (FR-001).
 * A gesture the center does not know is refused before the engine: never allowed (FR-006). An
 * allowance or an approval is journaled with the gesture's own change; a refusal in a transaction
 * of its own, so it stays journaled when the refused gesture's transaction is rolled back.
 */
export async function decideFor(
  db: SqlExecutor,
  organizationId: string,
  gesture: Gesture,
): Promise<JournaledDecision> {
  const kind = gesture.kind as GestureKind;
  if (!knownGestures.includes(kind)) {
    throw new GestureError('unknown_gesture', `The center does not know « ${gesture.kind} ».`);
  }
  if (gesture.object.kind !== objectOf[kind]) {
    throw new GestureError('wrong_object', `« ${kind} » acts on a ${objectOf[kind]}.`);
  }
  const full = completed(gesture);
  const entities = await entitiesFor(db, full);
  const policies = (await currentPolicies(db)).filter((p) => p.status !== 'off');
  const refused = engine.decide({ policies, gesture: full, entities }).effect === 'refuse';
  const decide = (on: SqlExecutor) =>
    decideGesture(on, organizationId, { engine, gesture: full, entities });
  return refused ? transaction(organizationId, decide) : decide(db);
}

/** What each policy did these last thirty days: as cited by the journal, and on trial. */
export interface PolicyCounts {
  allowed: number;
  asked: number;
  refused: number;
  trial: number;
}

export async function policyCounts(db: SqlExecutor): Promise<Map<string, PolicyCounts>> {
  const { rows } = await db.query<{
    policy_id: string;
    allowed: string;
    asked: string;
    refused: string;
    trial: string;
  }>(
    `select cited ->> 'id' as policy_id,
            count(*) filter (where not trial and cited ->> 'effect' = 'allow') as allowed,
            count(*) filter (where not trial and cited ->> 'effect' = 'approve') as asked,
            count(*) filter (where not trial and cited ->> 'effect' = 'refuse') as refused,
            count(*) filter (where trial) as trial
       from (select d.at, false as trial, p as cited from kete_policy_decisions d,
                    jsonb_array_elements(d.policies) p
             union all
             select d.at, true as trial, p as cited from kete_policy_decisions d,
                    jsonb_array_elements(d.trial) p) journal
      where at >= now() - interval '30 days'
      group by cited ->> 'id'`,
  );
  return new Map(
    rows.map((r) => [
      r.policy_id,
      {
        allowed: Number(r.allowed),
        asked: Number(r.asked),
        refused: Number(r.refused),
        trial: Number(r.trial),
      },
    ]),
  );
}

/** A circuit as its policy (spec 088, FR-003): opening a request of its subject asks it. */
export function circuitText(subject: string): string {
  return `permit (principal, action == Kete::Action::"request.open", resource == Kete::Subject::"${subject}");`;
}

/** Defining a circuit writes its approval policy: a new version each time it is defined. */
export async function saveCircuitPolicy(
  db: SqlExecutor,
  organizationId: string,
  circuit: { subject: string; name: string; definedBy: string },
): Promise<void> {
  await savePolicy(db, organizationId, engine, {
    id: `circuit.${circuit.subject}`,
    sentence: policyWords().circuit(circuit.name),
    rule: circuitText(circuit.subject),
    set: 'approval',
    approver: 'circuit',
    owner: circuit.definedBy,
    // A circuit applies from its definition, as it always did.
    status: 'active',
    writtenBy: circuit.definedBy,
  });
}

/** The people an approval names, found today (FR-004). */
export interface Approvers {
  approver: string;
  /** Their accounts; none when nobody is found — the administrators then decide. */
  people: string[];
}

const RULED = /^(role|position|person):(.+)$/;

/**
 * Who approves, by relation or role: `manager` (her manager today; away, her deputy), `on_behalf_of`
 * (the person an agent works for), `project.holder` (the project's lead), `role:…`, `position:…`,
 * `person:…` (as a circuit's step finds them), `circuit` (the circuit's own steps decide).
 */
export async function approversFor(
  db: SqlExecutor,
  gesture: Gesture,
  approvers: readonly string[],
): Promise<Approvers[]> {
  const behind = await personBehind(db, gesture.actor);
  const structure = await centerStructure(db, new Date(gesture.at));
  const today = gesture.at.slice(0, 10);
  const place = await placeOf(db, behind);
  const projectId = gesture.object.kind === 'project' ? gesture.object.id : null;
  const found: Approvers[] = [];
  for (const approver of approvers) {
    let people: string[] = [];
    if (approver === 'manager') {
      const manager = structure.structure.managerOf(behind);
      const deputy =
        manager && awayOn(structure.absences, manager, today)
          ? structure.structure.deputyOf(manager)
          : null;
      people = deputy ? [deputy] : manager ? [manager] : [];
    } else if (approver === 'on_behalf_of') {
      people = gesture.actor.kind === 'agent' ? [behind] : [];
    } else if (approver === 'project.holder' && projectId) {
      people = [
        ...(await approversOf(
          db,
          { requesterUserId: behind, unitId: place.primaryUnit, projectId },
          { rule: 'project_lead' },
        )),
      ];
    } else {
      const ruled = RULED.exec(approver);
      if (ruled) {
        const [, rule, id] = ruled as unknown as [string, 'role' | 'position' | 'person', string];
        const step =
          rule === 'role'
            ? { rule, roleId: id }
            : rule === 'position'
              ? { rule, positionId: id }
              : { rule, personId: id };
        people = [
          ...(await approversOf(
            db,
            { requesterUserId: behind, unitId: place.primaryUnit, projectId },
            step,
          )),
        ];
      }
    }
    // Never the one who asks (D-028) — but the person an agent asks for is who approves it.
    const asker = approver === 'on_behalf_of' ? null : behind;
    found.push({ approver, people: people.filter((p) => p !== asker).sort() });
  }
  return found;
}
