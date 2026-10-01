import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
export const resourceId = id('res');
export const promotionId = id('prm');

/** What a company's people create with AI, and what the registry keeps (doctrine D-028). */
export const resourceKinds = ['app', 'skill', 'mcp', 'agent'] as const;
export type ResourceKind = (typeof resourceKinds)[number];

/** Where a resource is visible: its owner's space, a unit and below, or the whole organization. */
export type Tier =
  { kind: 'personal' } | { kind: 'unit'; unitId: string } | { kind: 'organization' };

export const risks = ['unknown', 'low', 'medium', 'high'] as const;
export type Risk = (typeof risks)[number];

export const registerInput = z.object({
  kind: z.enum(resourceKinds),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  /** An app's or an MCP server's address: its identity card is read from there. */
  address: z.url({ protocol: /^https$/ }).optional(),
});

export const promotionTarget = z.union([
  z.object({ kind: z.literal('unit'), unitId: id('unt') }),
  z.object({ kind: z.literal('organization') }),
]);

export const requestPromotionInput = z.object({ resourceId, target: promotionTarget });

export const decidePromotionInput = z.object({
  promotionId,
  decision: z.enum(['approve', 'refuse']),
  reason: z.string().trim().max(1000).optional(),
});

export const retireInput = z.object({ resourceId });

/** An app's identity card, as `manifest.v1` declares it (kete-core spec 035). */
export interface IdentityCard {
  product: string;
  name: string;
  version: string;
  governance?: {
    owner: { name: string; contact?: string };
    dataCategories: string[];
    ai: { used: boolean; purpose?: string };
    criticality: 'low' | 'medium' | 'high' | 'critical';
  };
}

export interface Resource {
  resourceId: string;
  kind: ResourceKind;
  name: string;
  description: string | null;
  address: string | null;
  ownerUserId: string;
  ownerName: string;
  tier: Tier;
  status: 'active' | 'retired';
  card: IdentityCard | null;
  risk: Risk;
  createdAt: string;
}

export interface Promotion {
  promotionId: string;
  resourceId: string;
  target: Tier;
  requestedBy: string;
  status: 'pending' | 'approved' | 'refused';
  decidedBy: string | null;
  reason: string | null;
  createdAt: string;
}

const sensitive = new Set(['special', 'children', 'payment', 'credentials']);
const personal = new Set(['personal', 'financial', 'location', 'confidential']);

/**
 * The risk of a resource, from its identity card: high when an outage stops work or loses money,
 * or when it handles sensitive data; medium when it handles people's or the company's data, or
 * uses AI; low otherwise. Without a card, it is unknown — and flagged.
 */
export function riskOf(card: IdentityCard | null): Risk {
  const g = card?.governance;
  if (!g) return 'unknown';
  if (g.criticality === 'high' || g.criticality === 'critical') return 'high';
  if (g.dataCategories.some((c) => sensitive.has(c))) return 'high';
  if (g.criticality === 'medium' || g.ai.used || g.dataCategories.some((c) => personal.has(c))) {
    return 'medium';
  }
  return 'low';
}
