import * as m from '@/paraglide/messages.js';
import type { Page } from './shell';

// The center has three places named by what a person does there — Décider, Demander, Déléguer —
// and the apps behind (doctrine D-042). Every page belongs to one of them: the sidebar, « Tout »
// and the phone's tabs group by it. Pages merge inside their place step by step (docs/ROADMAP.md,
// steps C2 to C7); until then a place lists its pages.

export type Verb = 'decide' | 'ask' | 'delegate' | 'apps';

/** In the order a person meets them. */
export const verbs: Verb[] = ['decide', 'ask', 'delegate', 'apps'];

const placed: Partial<Record<Page, Verb>> = {
  home: 'decide',
  todo: 'decide',
  team: 'decide',
  notifications: 'decide',
  assistant: 'ask',
  dossiers: 'ask',
  notebook: 'ask',
  dashboards: 'ask',
  forms: 'ask',
  datasets: 'ask',
  documents: 'ask',
  library: 'ask',
  my_agents: 'delegate',
  routines: 'delegate',
  skills: 'delegate',
};

/** Where a page lives; a business tool is an app, behind the center. */
export const verbOf = (page: Page): Verb => placed[page] ?? 'apps';

export const verbLabel = (verb: Verb): string =>
  ({
    decide: m.nav_decide,
    ask: m.nav_ask,
    delegate: m.nav_delegate,
    apps: m.nav_apps,
  })[verb]();
