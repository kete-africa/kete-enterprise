import { z } from 'zod';

/**
 * The business modules an organization switches on or off (spec 010). The frame — structure,
 * rights, registry, decisions, the gateway — is always there.
 */
export const moduleKeys = [
  'surveys',
  'performance',
  'meetings',
  'compliance',
  'agents',
  'knowledge',
  'dossiers',
  'documents',
  'skills',
  'datasets',
  'forms',
  'dashboards',
] as const;
export type ModuleKey = (typeof moduleKeys)[number];

/** Modules delivered before modules existed stay on until switched off; new ones start off. */
export const onByDefault: Readonly<Record<ModuleKey, boolean>> = {
  surveys: false,
  performance: false,
  meetings: false,
  compliance: true,
  agents: true,
  knowledge: false,
  dossiers: false,
  documents: false,
  skills: false,
  datasets: false,
  forms: false,
  dashboards: false,
};

export const setModuleInput = z.object({
  module: z.enum(moduleKeys),
  enabled: z.boolean(),
});

export type Modules = Record<ModuleKey, boolean>;

export interface OrganizationSettings {
  /** A demo organization: fictitious people, and administrators may view the space as them. */
  demo: boolean;
}
