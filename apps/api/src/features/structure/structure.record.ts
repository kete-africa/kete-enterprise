import { z } from 'zod';

/** A date without time, as people write it: 2026-10-01. */
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is written YYYY-MM-DD.');

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
export const unitTypeId = id('utp');
export const unitId = id('unt');
export const positionId = id('pos');
export const personId = id('prs');
export const assignmentId = id('asg');

/** What kind of tie a person has to a position (ARCHITECTURE §13). */
export const assignmentKinds = [
  'primary',
  'functional',
  'project',
  'interim',
  'delegation',
] as const;
export type AssignmentKind = (typeof assignmentKinds)[number];

const name = z.string().trim().min(1).max(160);

export const createUnitTypeInput = z.object({
  /** A stable key, lowercase: `branch`, `legal_entity`, `team`. */
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  name,
  /** Whether units of this type are legal entities (a company, a subsidiary). */
  legalEntity: z.boolean().default(false),
});

export const createUnitInput = z.object({
  unitTypeId,
  /** The unit it belongs to; none for the top of the organization. */
  parentId: unitId.optional(),
  name,
  code: z.string().trim().min(1).max(40).optional(),
  /** ISO 3166 country code, for units tied to a country. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  startsOn: day.optional(),
});

export const moveUnitInput = z.object({ unitId, parentId: unitId.nullable() });
export const closeUnitInput = z.object({ unitId, endsOn: day });

export const createPositionInput = z.object({
  unitId,
  title: name,
  /** The position it reports to, in any unit or legal entity. */
  reportsTo: positionId.optional(),
  startsOn: day.optional(),
});
export const closePositionInput = z.object({ positionId, endsOn: day });

export const addPersonInput = z.object({
  name,
  email: z.email().optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'A phone number is written +228…')
    .optional(),
  /** Her Compte Kete account, when she has one; field staff may have none. */
  accountUserId: z.string().min(1).max(128).optional(),
});

/** A correction of a person: a field left out stays, `null` empties it. */
export const updatePersonInput = z.object({
  personId,
  name: name.optional(),
  email: z.email().nullable().optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'A phone number is written +228…')
    .nullable()
    .optional(),
});

/** An administrator links a person to a Compte Kete account, or unlinks her (`null`). */
export const linkPersonAccountInput = z.object({
  personId,
  accountUserId: z.string().min(1).max(128).nullable(),
});

/**
 * A list of people to create at once, each with her primary position from the day of import. Rows
 * are checked one by one: a refused row does not stop the others.
 */
export const importPeopleInput = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().max(400),
        email: z.string().max(400).optional(),
        phone: z.string().max(40).optional(),
        positionId: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(500),
  startsOn: day.optional(),
});

export interface ImportReport {
  created: number;
  refused: { row: number; code: 'invalid_row' | 'not_found' | 'closed' | 'duplicate_email' }[];
}

export const assignPersonInput = z.object({
  personId,
  positionId,
  kind: z.enum(assignmentKinds),
  startsOn: day,
  endsOn: day.optional(),
});
export const endAssignmentInput = z.object({ assignmentId, endsOn: day });

export interface UnitType {
  unitTypeId: string;
  key: string;
  name: string;
  legalEntity: boolean;
}

export interface Unit {
  unitId: string;
  unitTypeId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  country: string | null;
  startsOn: string;
  endsOn: string | null;
}

export interface Position {
  positionId: string;
  unitId: string;
  title: string;
  reportsTo: string | null;
  startsOn: string;
  endsOn: string | null;
}

export interface Person {
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountUserId: string | null;
}

export interface Assignment {
  assignmentId: string;
  personId: string;
  positionId: string;
  kind: AssignmentKind;
  startsOn: string;
  endsOn: string | null;
}

/** The organization as of a date: what existed then, and who held what. */
export interface Chart {
  asOf: string;
  unitTypes: UnitType[];
  units: Unit[];
  positions: Position[];
  people: Person[];
  assignments: Assignment[];
}
