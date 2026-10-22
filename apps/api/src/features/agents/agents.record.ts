import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
export const agentId = id('agt');
export const signalId = id('sig');

/** A person's agent, a position's (it acts for whoever holds it), or the system's (D-039). */
export const agentKinds = ['personal', 'position', 'system'] as const;
export type AgentKind = (typeof agentKinds)[number];

/** What an agent may watch: each watch is a feature's, plugged into the agents. */
export const watchName = z.string().regex(/^[a-z]+$/);

/** An agent's job description (doctrine PRINCIPES: mission, scope, rights, budget, a human). */
export const createAgentInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(agentKinds),
    mission: z.string().trim().min(1).max(2000),
    /** For a person's or the system's agent: who answers for it (default: its creator). */
    responsibleUserId: z.string().min(1).max(128).optional(),
    /** For a position's agent: it acts for whoever holds the position. */
    positionId: id('pos').optional(),
    /** A unit and everything under it; none for the whole of its person's reach. */
    scopeUnitId: id('unt').optional(),
    permissions: z
      .array(z.string().regex(/^[a-z]+:[a-z_]+$/))
      .max(50)
      .default([]),
    autonomyMax: z.number().int().min(1).max(4).default(1),
    /** Its drafts left open at once, before it waits (D-039). */
    draftBudget: z.number().int().min(0).max(100).default(5),
    wakeEveryMinutes: z
      .number()
      .int()
      .min(5)
      .max(7 * 24 * 60)
      .default(60),
    watches: z.array(watchName).min(1).max(10),
    /** Born from one sentence (spec 099, FR-017): on trial, it only proposes for two weeks. */
    fromSentence: z.boolean().default(false),
    covers: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  })
  .refine((a) => (a.kind === 'position') === Boolean(a.positionId), {
    message: "A position's agent names its position, and only it does.",
  });

export const agentStatusInput = z.object({ agentId, status: z.enum(['active', 'paused']) });

/**
 * Its level for one kind of task — one permission it holds (spec 052): 1 read, 2 act where it can
 * be undone, 3 prepare a draft; none to follow its maximum. Committing is never set per task.
 */
export const agentAutonomyInput = z.object({
  agentId,
  permission: z.string().regex(/^[a-z]+:[a-z_]+$/),
  level: z.number().int().min(1).max(3).nullable(),
});

/** A job description to try before it exists: what it would watch, with which rights. */
export const dryRunInput = z.object({
  watches: z.array(watchName).min(1).max(10),
  permissions: z
    .array(z.string().regex(/^[a-z]+:[a-z_]+$/))
    .max(50)
    .default([]),
  scopeUnitId: id('unt').optional(),
});

/** Its person opens it to colleagues, or keeps it to herself (spec 066, doctrine D-044). */
export const agentSharingInput = z.object({
  agentId,
  visibility: z.enum(['private', 'shared']),
  sharedWith: z.array(id('unt')).max(20).default([]),
});

export interface Agent {
  agentId: string;
  name: string;
  kind: AgentKind;
  mission: string;
  responsibleUserId: string | null;
  positionId: string | null;
  scopeUnitId: string | null;
  permissions: string[];
  autonomyMax: number;
  /** Its level per permission, never above its maximum (spec 052). */
  autonomyByPermission: Record<string, number>;
  draftBudget: number;
  wakeEveryMinutes: number;
  watches: string[];
  status: 'active' | 'paused';
  /** Private: its person and the administrator. Shared: colleagues may call it (D-044). */
  visibility: 'private' | 'shared';
  /** The units it is open to, each with everything under it; none for the whole organization. */
  sharedWith: string[];
  nextWakeAt: string;
  lastRunAt: string | null;
  /**
   * What it takes on (spec 099, FR-016): a holding of its person its job description covers, any
   * other of hers, a mention in a thread — never, it proposes, or it takes it alone. The holding
   * stays its person's; the agent is only its delegate.
   */
  takeOn: Record<'described' | 'other' | 'mention', TakeOnLevel>;
  /** The words of the holdings its job description covers (« relance », « impayé »). */
  covers: string[];
  /** Its own computer, its minutes a month; none: no computer. */
  computerMinutes: number | null;
  /** Whom it returns its work to: who gave it (or the holding's return), or its person. */
  returnTo: 'giver' | 'owner';
  /** Born from one sentence, it is on trial until then: it only proposes. */
  trialUntil: string | null;
  /** When it sets to work by itself: every day or every working day, at a time. */
  routine: { time: string; cadence: 'daily' | 'weekdays'; instruction: string } | null;
  createdAt: string;
}

export const takeOnLevels = ['never', 'proposes', 'alone'] as const;
export type TakeOnLevel = (typeof takeOnLevels)[number];

/** Its job description at work (spec 099, FR-016), as its person sets it in its thread. */
export const jobInput = z.object({
  agentId,
  takeOn: z
    .object({
      described: z.enum(takeOnLevels),
      other: z.enum(takeOnLevels),
      mention: z.enum(takeOnLevels),
    })
    .partial()
    .optional(),
  covers: z.array(z.string().trim().min(2).max(40)).max(20).optional(),
  computerMinutes: z.number().int().min(1).max(10000).nullable().optional(),
  returnTo: z.enum(['giver', 'owner']).optional(),
  routine: z
    .object({
      time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
      cadence: z.enum(['daily', 'weekdays']),
      instruction: z.string().trim().min(2).max(2000),
    })
    .nullable()
    .optional(),
});

/** Something a watch found: its key makes it one signal, however many times the agent wakes. */
export interface Finding {
  key: string;
  kind: string;
  subject: string;
  unitId: string | null;
  details: Record<string, unknown>;
}

export interface Signal extends Finding {
  signalId: string;
  agentId: string;
  watch: string;
  raisedAt: string;
  closedAt: string | null;
  closedReason: 'solved' | 'resolved' | null;
}

export const raiseSignalInput = z.object({
  agentId,
  watch: watchName,
  key: z.string().min(1).max(300),
  kind: z.string().regex(/^[a-z]+\.[a-z_]+$/),
  subject: z.string().min(1).max(300),
  unitId: id('unt').nullable(),
  details: z.record(z.string(), z.unknown()),
});

export const closeSignalInput = z.object({
  signalId,
  reason: z.enum(['solved', 'resolved']),
});
