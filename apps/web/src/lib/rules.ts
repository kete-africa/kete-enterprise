import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// The organization's rules for its agents (spec 068, doctrine D-043): written by an administrator,
// tried on the last month, switched on — and what they refused.

export type RuleFamily =
  'data' | 'models' | 'tools' | 'autonomy' | 'retention' | 'transparency' | 'budgets' | 'exit';
export type RuleState = 'trial' | 'active' | 'off';

export interface Rule {
  ruleId: string;
  family: RuleFamily;
  sentence: string;
  effect: 'forbid' | 'person';
  permissions: string[];
  state: RuleState;
  simulatedAt: string | null;
  lastMonth: { refused: number; counted: number };
}

export interface Refusal {
  refusalId: string;
  rule: string;
  trial: boolean;
  agentId: string;
  agentName: string | null;
  tool: string;
  permission: string;
  channel: string;
  at: string;
}

export interface Simulation {
  days: number;
  steps: number;
  refused: number;
  examples: { agent: string; tool: string; at: string }[];
}

export interface RulesScreen {
  rules: Rule[];
  families: { family: RuleFamily; applied: boolean }[];
  permissions: string[];
  refusals: Refusal[];
}

export const fetchRules = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RulesScreen> => {
    const request = getRequest();
    const [screen, journal] = await Promise.all([
      callApi<Omit<RulesScreen, 'refusals'>>(request, '/v1/rules'),
      callApi<{ refusals: Refusal[] }>(request, '/v1/rules/refusals'),
    ]);
    return { ...screen, refusals: journal.refusals.slice(0, 30) };
  },
);

const ruleId = (value: unknown) => {
  if (typeof value !== 'string' || !/^rul_[0-9a-f-]{8,64}$/.test(value))
    throw new Error('Unknown.');
  return value;
};

export const createRule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      family: typeof v.family === 'string' ? v.family.slice(0, 20) : '',
      sentence: typeof v.sentence === 'string' ? v.sentence.trim().slice(0, 300) : '',
      permissions: Array.isArray(v.permissions)
        ? v.permissions.filter((p): p is string => typeof p === 'string').slice(0, 50)
        : [],
    };
  })
  .handler(({ data }) =>
    sendGesture<{ rule: Rule }>(getRequest(), '/v1/rules', data, crypto.randomUUID()),
  );

export const simulateRule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ ruleId: ruleId((input as { ruleId?: unknown })?.ruleId) }))
  .handler(({ data }) =>
    sendGesture<{ simulation: Simulation }>(
      getRequest(),
      `/v1/rules/${data.ruleId}/simulate`,
      {},
      crypto.randomUUID(),
    ),
  );

export const setRuleState = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { ruleId?: unknown; state?: unknown };
    if (v.state !== 'trial' && v.state !== 'active' && v.state !== 'off')
      throw new Error('Unknown.');
    return { ruleId: ruleId(v.ruleId), state: v.state as RuleState };
  })
  .handler(({ data }) =>
    sendGesture<{ state: RuleState }>(
      getRequest(),
      `/v1/rules/${data.ruleId}/state`,
      { state: data.state },
      crypto.randomUUID(),
    ),
  );
