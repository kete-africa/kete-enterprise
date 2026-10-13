import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// « Mon accueil » (spec 067, doctrine D-044): what arrives at a person and who takes care of it —
// her rules, her absence, and a trial on a request. Hers alone.

export interface ReceptionRule {
  ruleId: string;
  words: string[];
  agent: { agentId: string; name: string };
  /** False while its agent is paused or the organization's agents are stopped. */
  applies: boolean;
}

export interface Reception {
  rules: ReceptionRule[];
  absence: {
    startsOn: string;
    endsOn: string;
    delegate: { userId: string; name: string };
  } | null;
}

export interface ReceptionTrial {
  handledBy:
    | { kind: 'me' }
    | { kind: 'agent'; name: string; word: string }
    | { kind: 'away'; name: string; until: string };
  returns: 'signed';
}

export const fetchReception = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Reception>(getRequest(), '/v1/reception'),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const day = (value: unknown) => {
  const date = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
};

export type ReceptionChange =
  | { kind: 'rule'; words: string; agentId: string }
  | { kind: 'remove'; ruleId: string }
  | { kind: 'absence'; startsOn: string; endsOn: string; colleague: string }
  | { kind: 'back' };

export const changeReception = createServerFn({ method: 'POST' })
  .validator((input: unknown): ReceptionChange => {
    const v = (input ?? {}) as Record<string, unknown>;
    switch (v.kind) {
      case 'rule':
        return { kind: 'rule', words: text(v.words, 600), agentId: text(v.agentId, 80) };
      case 'remove': {
        const ruleId = text(v.ruleId, 80);
        if (!/^rcp_[0-9a-f-]{8,64}$/.test(ruleId)) throw new Error('Unknown.');
        return { kind: 'remove', ruleId };
      }
      case 'absence':
        return {
          kind: 'absence',
          startsOn: day(v.startsOn),
          endsOn: day(v.endsOn),
          colleague: text(v.colleague, 128),
        };
      case 'back':
        return { kind: 'back' };
      default:
        throw new Error('Unknown.');
    }
  })
  .handler(({ data }) => {
    const send = (path: string, body: object) =>
      sendGesture<Reception>(getRequest(), `/v1/reception${path}`, body, crypto.randomUUID());
    switch (data.kind) {
      case 'rule':
        return send('/rules', {
          // Her words, separated by commas.
          words: data.words
            .split(',')
            .map((word) => word.trim())
            .filter((word) => word.length >= 2)
            .slice(0, 10),
          agentId: data.agentId,
        });
      case 'remove':
        return send(`/rules/${data.ruleId}/remove`, {});
      case 'absence':
        return send('/absence', {
          startsOn: data.startsOn,
          endsOn: data.endsOn,
          colleague: data.colleague,
        });
      case 'back':
        return send('/absence/clear', {});
    }
  });

export const tryReception = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ title: text((input as { title?: unknown })?.title, 200) }))
  .handler(({ data }) =>
    sendGesture<{ trial: ReceptionTrial }>(
      getRequest(),
      '/v1/reception/try',
      data,
      crypto.randomUUID(),
    ),
  );
