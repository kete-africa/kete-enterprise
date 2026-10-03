import { defineCapability } from '@kete/capabilities';
import { z } from 'zod';
import { actingPerson } from '../../platform/acting.js';
import { createAction } from '../actions/index.js';
import { inboxFor } from '../decisions/index.js';
import { measureFromReading, readingsToTake } from '../performance/index.js';
import { registerInput, registerResourceForAgent, registryFor } from '../registry/index.js';
import { covers, reach } from '../rights/index.js';
import { chartFor } from '../structure/index.js';
import { factsFor } from '../workspace/index.js';

/** Everyone reaches the gateway; what each tool returns is what the person may see (spec 006). */
export const GATEWAY_PERMISSION = 'gateway:use';

function person() {
  const acting = actingPerson();
  if (!acting) throw new Error('A gateway call acts for a person.');
  return acting;
}

const today = () => new Date().toISOString().slice(0, 10);

/** What a person's copilot may do with Kete Enterprise, and how far alone. */
export const gatewayCapabilities = [
  defineCapability({
    name: 'my_day',
    description:
      "What waits for the person and where she stands: forms to fill in, decisions to take, her open actions (overdue first), decision notes to read, her quarterly reviews with their red and orange indicators, her team's reviews if she manages people, the last meetings' decisions, and her apps. Nothing about pay.",
    permission: GATEWAY_PERMISSION,
    autonomy: 1,
    input: z.object({}),
    run: (_input, { db }) => factsFor(db, { ...person(), name: person().name }),
  }),
  defineCapability({
    name: 'structure_chart',
    description:
      'The organization as the person may see it at a date (default today): units under one another, positions, and who holds them.',
    permission: GATEWAY_PERMISSION,
    autonomy: 1,
    input: z.object({
      asOf: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    async run(input, { db }) {
      const chart = await chartFor(db, person(), input.asOf ?? today());
      const name = new Map(chart.people.map((p) => [p.personId, p.name]));
      return {
        asOf: chart.asOf,
        units: chart.units.map((u) => ({
          unitId: u.unitId,
          name: u.name,
          parentId: u.parentId,
          country: u.country,
          positions: chart.positions
            .filter((p) => p.unitId === u.unitId)
            .map((p) => ({
              title: p.title,
              reportsTo: p.reportsTo,
              holders: chart.assignments
                .filter((a) => a.positionId === p.positionId)
                .map((a) => ({ name: name.get(a.personId) ?? null, kind: a.kind })),
            })),
        })),
      };
    },
  }),
  defineCapability({
    name: 'registry_list',
    description:
      "The company's apps, skills, MCP servers and agents the person may see, with their owner, tier, risk and flags.",
    permission: GATEWAY_PERMISSION,
    autonomy: 1,
    input: z.object({}),
    async run(_input, { db }) {
      const registry = await registryFor(db, person());
      return registry.resources.map((r) => ({
        resourceId: r.resourceId,
        kind: r.kind,
        name: r.name,
        owner: r.ownerName,
        tier: r.tier,
        risk: r.risk,
        status: r.status,
        flags: r.flags,
      }));
    },
  }),
  // Level 2: it lands in the person's own space, and is undone by retiring it.
  defineCapability({
    name: 'registry_register',
    description:
      "Registers an app, a skill, an MCP server or an agent in the person's own space. For an app or an MCP server, give its https address: its identity card is read from there.",
    permission: GATEWAY_PERMISSION,
    autonomy: 2,
    input: registerInput,
    command: registerResourceForAgent,
  }),
  defineCapability({
    name: 'decisions_inbox',
    description:
      "What waits for the person's decision, and her own requests. Deciding is hers: open the Inbox in Kete Enterprise.",
    permission: GATEWAY_PERMISSION,
    autonomy: 1,
    input: z.object({}),
    async run(_input, { db }) {
      const inbox = await inboxFor(db, person());
      const summary = (r: (typeof inbox.toDecide)[number]) => ({
        requestId: r.requestId,
        subject: r.subject,
        title: r.title,
        status: r.status,
        currentStep: r.currentStep,
        overdue: r.overdue,
      });
      return { toDecide: inbox.toDecide.map(summary), mine: inbox.mine.map(summary) };
    },
  }),
  // Level 1: what an agent may propose to measure, in the units where the person measures.
  defineCapability({
    name: 'performance_readings_to_take',
    description:
      'Readings sent by connected apps (the helpdesk…) that match a line still without a value in an open quarterly review, in the units where the person measures: review, holder, line position, indicator, reading, value and proof.',
    permission: 'performance:measure',
    autonomy: 1,
    input: z.object({}),
    async run(_input, { db }) {
      const scope = await reach(db, person(), 'performance:measure');
      return { toTake: await readingsToTake(db, (unitId) => covers(scope, unitId)) };
    },
  }),
  // Level 3: a measure counts in the variable part: the agent prepares it, the person validates.
  defineCapability({
    name: 'performance_propose_measure',
    description:
      'Prepares, as a draft for the person to validate, the measure of a review line from a reading (take reviewId, position and readingId from performance_readings_to_take). Nothing is measured until she validates.',
    permission: 'performance:measure',
    autonomy: 3,
    input: measureFromReading.input,
    command: measureFromReading,
    draft: { recordType: 'review-measure' },
  }),
  // Level 3: an action engages its owner: the agent prepares it, the person validates.
  defineCapability({
    name: 'actions_propose',
    description:
      'Prepares, as a draft for the person to validate, an action of the register: a title, its owner (a personId from structure_chart), a deadline (YYYY-MM-DD) and details. Nothing is created until she validates.',
    permission: 'meetings:manage',
    autonomy: 3,
    input: createAction.input,
    command: createAction,
    draft: { recordType: 'action' },
  }),
];
