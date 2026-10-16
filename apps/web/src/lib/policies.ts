import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';

// The organization's policies (doctrine D-058; specs 088, 090): a sentence, its Cedar rule proposed
// by the model and checked, born on trial, then in force; every decision journaled with them.

export interface Policy {
  id: string;
  version: number;
  sentence: string;
  rule: string;
  set: 'authority' | 'approval';
  approver?: string;
  owner: string;
  status: 'active' | 'trial' | 'off';
  kete: boolean;
  lastMonth: { allowed: number; asked: number; refused: number; trial: number };
}

export interface Decision {
  decisionId: string;
  gesture: {
    actor: { kind: 'person' | 'agent'; id: string; on_behalf_of?: string };
    kind: string;
    object: { kind: string; id: string };
    channel?: string;
  };
  effect: 'allow' | 'approve' | 'refuse';
  policies: { id: string; version: number; effect: string; reason: string }[];
  trial: { id: string; reason: string }[];
  at: string;
}

export interface Proposal {
  set: 'authority' | 'approval';
  approver: string | null;
  rule: string;
  explanation: string;
  check: { ok: boolean; errors: string[] };
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const fetchPolicies = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest();
  const [listed, journal] = await Promise.all([
    callApi<{ policies: Policy[]; gestures: string[] }>(request, '/v1/policies'),
    callApi<{ decisions: Decision[] }>(request, '/v1/policies/journal'),
  ]);
  return { ...listed, decisions: journal.decisions.slice(0, 40) };
});

/** The model proposes the rule of her sentence; nothing is kept. */
export const proposePolicy = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    sentence: text((input as { sentence?: unknown })?.sentence, 500),
  }))
  .handler(async ({ data }): Promise<GestureAnswer<{ proposal: Proposal }>> =>
    sendGesture(getRequest(), '/v1/policies/propose', data, crypto.randomUUID()),
  );

/** Whether a rule fits the center's schema, and why not. */
export const checkRule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ rule: text((input as { rule?: unknown })?.rule, 4000) }))
  .handler(async ({ data }): Promise<GestureAnswer<{ ok: boolean; errors: string[] }>> =>
    sendGesture(getRequest(), '/v1/policies/check', data, crypto.randomUUID()),
  );

/** A policy kept as she validated it: always born on trial. */
export const savePolicy = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const set = v.set === 'approval' ? ('approval' as const) : ('authority' as const);
    const approver = text(v.approver, 80);
    return {
      id: text(v.id, 80),
      sentence: text(v.sentence, 500),
      rule: text(v.rule, 4000),
      set,
      ...(set === 'approval' ? { approver: approver || 'manager' } : {}),
    };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ policy: Policy; issues?: string[] }>> =>
    sendGesture(getRequest(), '/v1/policies', data, crypto.randomUUID()),
  );

/** In force, back on trial, or off: a new version. */
export const setPolicyStatus = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const status = v.status === 'active' || v.status === 'off' ? v.status : ('trial' as const);
    return { policyId: text(v.policyId, 80), status };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ policy: Policy }>> =>
    sendGesture(
      getRequest(),
      `/v1/policies/${encodeURIComponent(data.policyId)}/status`,
      { status: data.status },
      crypto.randomUUID(),
    ),
  );
