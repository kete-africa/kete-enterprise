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
  })
  .refine((a) => (a.kind === 'position') === Boolean(a.positionId), {
    message: "A position's agent names its position, and only it does.",
  });

export const agentStatusInput = z.object({ agentId, status: z.enum(['active', 'paused']) });

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
  draftBudget: number;
  wakeEveryMinutes: number;
  watches: string[];
  status: 'active' | 'paused';
  nextWakeAt: string;
  lastRunAt: string | null;
}

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
