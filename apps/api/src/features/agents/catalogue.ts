import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { validateAgentTemplate, type AgentTemplate } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { listResources, registerAgent } from '../registry/index.js';
import { AgentRuleError } from './commands.js';
import { findAgent, insertAgent, setJob } from './infrastructure/agents.tables.js';

// The catalogue of agents (spec 104; doctrine D-062, R5; kete-core ADR 0018 and spec 146): agents
// the center and the apps ship, ready to be taken. An administrator enables a template for the
// organization; each person takes it for herself — it acts for her, with her rights, drawing only
// on its sources, woken by its triggers. Never a shared agent nobody answers for.

/** Kete's own templates: what the center ships with, generic to any organization. */
export const centerTemplates: AgentTemplate[] = [
  {
    name: 'parc',
    label: { fr: 'Agent Parc', en: 'Fleet agent' },
    mission: {
      fr: 'Quand un équipement passe en alerte, regarde son histoire, ses liens et ce qui est en cours, et propose une intervention à la personne qui en répond. Rien n’est engagé sans elle.',
      en: 'When an asset turns to alert, read its history, links and what is in progress, and propose an intervention to whoever answers for it. Nothing is committed without her.',
    },
    sources: ['kete', 'knowledge'],
    permissions: ['objects:read'],
    triggers: [{ event: 'object.state_changed', object_kind: 'asset', state: 'alert' }],
    take_on: 'propose',
    autonomy_max: 3,
    avatar: { glyph: 'sun', tint: 'amber' },
  },
  {
    name: 'indicateurs',
    label: { fr: 'Agent Indicateurs', en: 'Indicators agent' },
    mission: {
      fr: 'Quand un indicateur dont vous répondez passe au rouge, lisez d’où vient le chiffre et ce qui l’explique, puis préparez l’action corrective à valider. Une donnée absente se fait remonter, jamais deviner.',
      en: 'When an indicator you answer for turns red, read where the figure comes from and what explains it, then prepare the corrective action to validate. A missing figure is reported, never guessed.',
    },
    sources: ['kete', 'team_data', 'knowledge'],
    triggers: [{ event: 'indicator.turned_red' }],
    take_on: 'propose',
    autonomy_max: 3,
    avatar: { glyph: 'board', tint: 'red' },
  },
];

export const CENTER_PRODUCT = 'center';

export interface CatalogueEntry {
  product: string;
  /** Who ships it: Kete, or the app's name. */
  shippedBy: string | null;
  template: AgentTemplate;
  enabled: boolean;
}

/** Every template the organization could enable: Kete's, and those its apps' cards declare. */
export async function catalogueOf(db: SqlExecutor): Promise<CatalogueEntry[]> {
  const { rows } = await db.query<{ product: string; name: string }>(
    `select product, name from agent_templates_enabled`,
  );
  const enabled = new Set(rows.map((r) => `${r.product}:${r.name}`));
  const apps = (await listResources(db)).filter(
    (r) => r.kind === 'app' && r.status === 'active' && r.card,
  );
  const fromApps = apps.flatMap((r) => {
    const card = r.card as unknown as { product: string; agents?: unknown[] };
    // What breaks the contract never reaches anyone.
    return (card.agents ?? [])
      .filter((t): t is AgentTemplate => validateAgentTemplate(t).ok)
      .map((template) => ({ product: card.product, shippedBy: r.name, template }));
  });
  return [
    ...centerTemplates.map((template) => ({
      product: CENTER_PRODUCT,
      shippedBy: null,
      template,
    })),
    ...fromApps,
  ].map((entry) => ({
    ...entry,
    enabled: enabled.has(`${entry.product}:${entry.template.name}`),
  }));
}

const which = z.object({
  product: z.string().min(1).max(80),
  name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
});

/** A template opened to the organization's people, or closed again (an administrator). */
export const enableAgentTemplate = defineCommand({
  name: 'enable-agent-template',
  input: which.extend({ enabled: z.boolean(), by: z.string().min(1).max(128) }),
  reversibility: { reversible: true, inverse: 'enable-agent-template' },
  async handler(input, { db, organizationId }) {
    const entry = (await catalogueOf(db)).find(
      (e) => e.product === input.product && e.template.name === input.name,
    );
    if (!entry) throw new AgentRuleError('not_found', 'No such template in the catalogue.');
    if (input.enabled) {
      await db.query(
        `insert into agent_templates_enabled (organization_id, product, name, enabled_by)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [organizationId, input.product, input.name, input.by],
      );
    } else {
      await db.query(`delete from agent_templates_enabled where product = $1 and name = $2`, [
        input.product,
        input.name,
      ]);
    }
    return { product: input.product, name: input.name, enabled: input.enabled };
  },
  summarize: (input) => `Template ${input.product}:${input.name} ${input.enabled ? 'on' : 'off'}`,
});

const takeOnOf = { never: 'never', propose: 'proposes', alone: 'alone' } as const;

/**
 * A person takes an enabled template: her own agent, with its mission, sources, level, take-on,
 * routine and the events it follows. It acts for her, with her rights, never more.
 */
export const takeAgentTemplate = defineCommand({
  name: 'take-agent-template',
  input: which,
  reversibility: { reversible: true, inverse: 'update-agent-status' },
  async handler(input, { db, organizationId, actor }) {
    const person = actor.onBehalfOf?.id ?? actor.id;
    const entry = (await catalogueOf(db)).find(
      (e) => e.product === input.product && e.template.name === input.name,
    );
    if (!entry?.enabled) throw new AgentRuleError('not_found', 'This template is not open here.');
    const t = entry.template;
    const created = await insertAgent(db, organizationId, {
      name: t.label.fr,
      kind: 'personal',
      mission: t.mission.fr,
      responsibleUserId: person,
      positionId: null,
      scopeUnitId: null,
      permissions: t.permissions ?? [],
      autonomyMax: t.autonomy_max ?? 1,
      draftBudget: 5,
      wakeEveryMinutes: 60,
      watches: [],
    });
    let routine: { time: string; ask: string } | null = null;
    for (const trigger of t.triggers ?? []) {
      if ('routine' in trigger) routine = { time: trigger.routine, ask: trigger.ask?.fr ?? '' };
    }
    await setJob(db, created.agentId, {
      sources: t.sources,
      ...(t.take_on ? { takeOn: { described: takeOnOf[t.take_on] } } : {}),
      ...(routine
        ? {
            routine: {
              time: routine.time,
              cadence: 'daily' as const,
              instruction: routine.ask || t.mission.fr,
            },
          }
        : {}),
    });
    await db.query(`update agents set template = $2, face = $3 where agent_id = $1`, [
      created.agentId,
      `${input.product}:${input.name}`,
      t.avatar ? JSON.stringify(t.avatar) : null,
    ]);
    // What wakes it: the events it follows, as subscriptions of its own (spec 101).
    for (const trigger of t.triggers ?? []) {
      if (!('event' in trigger)) continue;
      await db.query(
        `insert into event_subscriptions (organization_id, subscription_id, consumer, consumer_id,
           type_pattern, object_kind, state, created_by)
         values ($1, $2, 'agent', $3, $4, $5, $6, $7)`,
        [
          organizationId,
          newId('sub'),
          created.agentId,
          trigger.event,
          trigger.object_kind ?? null,
          trigger.state ?? null,
          person,
        ],
      );
    }
    await registerAgent(db, organizationId, {
      name: created.name,
      mission: created.mission,
      ownerUserId: person,
    });
    return { agent: await findAgent(db, created.agentId) };
  },
  summarize: (input) => `Agent taken from ${input.product}:${input.name}`,
});
