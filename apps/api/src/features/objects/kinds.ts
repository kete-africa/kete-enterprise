import type { ObjectType } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { listResources } from '../registry/index.js';

// The kinds of objects (spec 100; doctrine D-062, R1; ADR 0014): the center declares its own
// references the way an app declares its kinds — states, axes, named links, where one opens — and
// reads the apps' kinds from the manifests its registry already keeps. One list, whoever owns it.

/** The product the center's own kinds belong to. */
export const CENTER = 'center';

const l = (fr: string, en: string) => ({ fr, en });

/** The center's references, declared once (D-047, D-056). */
export const centerKinds: ObjectType[] = [
  {
    kind: 'party',
    label: { ...l('Tiers', 'Third party'), fr_plural: 'Tiers', en_plural: 'Third parties' },
    icon: 'tiers',
    states: [
      { id: 'active', label: l('Actif', 'Active'), tone: 'ok' },
      { id: 'merged', label: l('Fusionné', 'Merged'), tone: 'neutral', closed: true },
    ],
    axes: ['party'],
    href: '/tiers/{id}',
  },
  {
    kind: 'project',
    label: { ...l('Projet', 'Project'), fr_plural: 'Projets', en_plural: 'Projects' },
    icon: 'folder',
    states: [
      { id: 'open', label: l('En cours', 'Open'), tone: 'info' },
      { id: 'delivered', label: l('Livré', 'Delivered'), tone: 'ok' },
      { id: 'closed', label: l('Clos', 'Closed'), tone: 'neutral', closed: true },
    ],
    axes: ['project', 'party', 'person'],
    href: '/projets/{id}',
  },
  {
    kind: 'unit',
    label: { ...l('Unité', 'Unit'), fr_plural: 'Unités', en_plural: 'Units' },
    icon: 'users',
    states: [
      { id: 'active', label: l('Active', 'Active'), tone: 'ok' },
      { id: 'closed', label: l('Fermée', 'Closed'), tone: 'neutral', closed: true },
    ],
    axes: ['unit'],
    href: '/administration/organisation?unite={id}',
  },
  {
    kind: 'place',
    label: { ...l('Lieu', 'Place'), fr_plural: 'Lieux', en_plural: 'Places' },
    icon: 'pin',
    states: [
      { id: 'active', label: l('Actif', 'Active'), tone: 'ok' },
      { id: 'archived', label: l('Archivé', 'Archived'), tone: 'neutral', closed: true },
    ],
    axes: ['party', 'unit'],
    href: '/lieux/{id}',
  },
  {
    kind: 'asset',
    label: { ...l('Équipement', 'Asset'), fr_plural: 'Équipements', en_plural: 'Assets' },
    icon: 'sun',
    states: [
      { id: 'in_service', label: l('En service', 'In service'), tone: 'ok' },
      { id: 'alert', label: l('En alerte', 'Alert'), tone: 'verify' },
      { id: 'maintenance', label: l('En maintenance', 'In maintenance'), tone: 'info' },
      { id: 'out_of_service', label: l('Hors service', 'Out of service'), tone: 'error' },
      { id: 'retired', label: l('Retiré', 'Retired'), tone: 'neutral', closed: true },
    ],
    axes: ['project', 'party', 'unit', 'person'],
    links: [
      {
        relation: 'produced_by',
        to: 'project',
        label: l('produit par', 'produced by'),
        inverse: l('a produit', 'produced'),
      },
      {
        relation: 'located_at',
        to: 'place',
        label: l('se trouve à', 'located at'),
        inverse: l('accueille', 'hosts'),
      },
    ],
    href: '/equipements/{id}',
  },
];

export interface Kind extends ObjectType {
  /** Who declared it: `center`, or the app's product. */
  product: string;
}

/**
 * Every kind of the organization: the center's, then those of its active apps, as their manifests
 * declare them. An app cannot take a center kind's name, nor another app's.
 */
export async function kindsOf(db: SqlExecutor): Promise<Kind[]> {
  const kinds: Kind[] = centerKinds.map((k) => ({ ...k, product: CENTER }));
  const taken = new Set(kinds.map((k) => k.kind));
  const apps = (await listResources(db)).filter((r) => r.kind === 'app' && r.status === 'active');
  for (const app of apps) {
    const declared = (app.card as { objects?: ObjectType[] } | null | undefined)?.objects ?? [];
    for (const kind of declared) {
      if (taken.has(kind.kind) || !app.card?.product) continue;
      taken.add(kind.kind);
      kinds.push({ ...kind, product: app.card.product });
    }
  }
  return kinds;
}

/** A state's words, in the reader's language. */
export function stateLabel(kind: Kind | undefined, state: string | null, lang: 'fr' | 'en' = 'fr') {
  if (!kind || !state) return null;
  return kind.states.find((s) => s.id === state)?.label[lang] ?? state;
}

/** Whether a state ends its object (R12): its thread is put away. */
export function isClosed(kind: Kind | undefined, state: string | null | undefined): boolean {
  return Boolean(kind && state && kind.states.find((s) => s.id === state)?.closed);
}
