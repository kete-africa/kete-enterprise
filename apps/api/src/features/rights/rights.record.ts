import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is written YYYY-MM-DD.');
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));

/** A permission is a feature and a verb: `structure:read`, `registry:review`. */
export const permission = z.string().regex(/^[a-z]+:[a-z_]+$/);

export const createRoleInput = z.object({
  name: z.string().trim().min(1).max(120),
  permissions: z.array(permission).max(100).default([]),
});

export const setRolePermissionsInput = z.object({
  roleId: id('rol'),
  permissions: z.array(permission).max(100),
});

/**
 * A role granted to a position (whoever holds it) or a person, on a scope: a unit and everything
 * under it, a country, or — with neither — the whole organization.
 */
export const grantRoleInput = z
  .object({
    roleId: id('rol'),
    positionId: id('pos').optional(),
    personId: id('prs').optional(),
    scopeUnitId: id('unt').optional(),
    scopeCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    startsOn: day.optional(),
    endsOn: day.optional(),
  })
  .refine((g) => (g.positionId ? 1 : 0) + (g.personId ? 1 : 0) === 1, {
    message: 'A role is granted to a position or to a person.',
  })
  .refine((g) => !(g.scopeUnitId && g.scopeCountry), {
    message: 'A scope is a unit or a country, not both.',
  });

export const revokeGrantInput = z.object({ grantId: id('grt'), endsOn: day });

export interface Role {
  roleId: string;
  name: string;
  permissions: string[];
}

export interface Grant {
  grantId: string;
  roleId: string;
  positionId: string | null;
  personId: string | null;
  scopeUnitId: string | null;
  scopeCountry: string | null;
  startsOn: string;
  endsOn: string | null;
}

/** What a person may do for one permission at a date: everywhere, or in these units. */
export interface Reach {
  everywhere: boolean;
  units: ReadonlySet<string>;
}

export const nowhere: Reach = { everywhere: false, units: new Set() };
