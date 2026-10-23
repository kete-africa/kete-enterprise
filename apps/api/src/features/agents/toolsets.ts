import type { CapabilityTool } from '@kete/capabilities';
import { transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { dashboardsOpen, dashboardTools } from '../dashboards/index.js';
import { datasetsOpen, datasetTools } from '../datasets/index.js';
import { documentsOpen, documentTools } from '../documents/index.js';
import { formsOpen, formTools } from '../forms/index.js';
import { knowledgeTool, libraryOpen } from '../knowledge/index.js';

// Kete's own tool sets (spec 104; doctrine D-062, R5; kete-core ADR 0018 and spec 146): what Kete's
// turn and an agent draw from beyond the gateway's gestures — the library, a team's tables, forms,
// document templates, dashboards — each open when its module is on and she may use it, each tool
// reading with her rights. An agent receives only the sets its job description names.

type Identity = IdentityVariables['identity'];

/** The names an agent's job description gives to Kete's own sets. */
export const KETE_SOURCES = [
  'kete',
  'knowledge',
  'team_data',
  'forms',
  'documents',
  'dashboards',
] as const;
export type KeteSource = (typeof KETE_SOURCES)[number];

/** Each set open to her now, by its name; « kete » (the gateway's gestures) is assembled apart. */
export async function keteToolSets(
  identity: Identity,
): Promise<Partial<Record<Exclude<KeteSource, 'kete'>, CapabilityTool[]>>> {
  const open = async (check: () => Promise<boolean>) => check().catch(() => false);
  const sets: Partial<Record<Exclude<KeteSource, 'kete'>, CapabilityTool[]>> = {};
  if (await open(() => transaction(identity.organizationId, (db) => libraryOpen(db, identity)))) {
    sets.knowledge = [knowledgeTool(identity)];
  }
  if (await open(() => datasetsOpen(identity))) sets.team_data = datasetTools(identity);
  if (await open(() => formsOpen(identity))) sets.forms = formTools(identity);
  if (await open(() => documentsOpen(identity))) sets.documents = documentTools(identity);
  if (await open(() => dashboardsOpen(identity))) sets.dashboards = dashboardTools(identity);
  return sets;
}

/**
 * An agent's share of Kete's own sets: only those its job description names, and only their tools
 * within its level — a set's tool above it never reaches it.
 */
export async function agentToolSets(
  identity: Identity,
  limits: { sources: readonly string[]; autonomyMax: number },
): Promise<CapabilityTool[]> {
  const sets = await keteToolSets(identity);
  return Object.entries(sets)
    .filter(([source]) => limits.sources.includes(source))
    .flatMap(([, tools]) => tools ?? [])
    .filter((tool) => tool.autonomy <= limits.autonomyMax);
}
