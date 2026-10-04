import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Skills (spec 031), as the API serves them.

export interface StoredSkill {
  skillId: string;
  name: string;
  description: string;
  audience: string[];
  enabled: boolean;
  version: string;
  createdBy: string;
  updatedAt: string;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown) => {
  const id = text(value, 80);
  if (!/^skl_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which skill?');
  return id;
};
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

export const fetchSkills = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{
    manage: boolean;
    shipped: { name: string; description: string }[];
    skills: StoredSkill[];
  }>(getRequest(), '/v1/skills'),
);

export const uploadSkill = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    data: text((input as { data?: unknown } | null)?.data, 14_000_000),
  }))
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture(getRequest(), '/v1/skills', { data: data.data }, crypto.randomUUID()),
    ),
  );

/** A gesture on one skill: change it (audience, on/off), remove it, or run its test cases. */
export const skillGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const action = v.action === 'remove' || v.action === 'evaluate' ? v.action : 'change';
    const change: Record<string, unknown> = {};
    if (v.audience === 'everyone') change.audience = ['everyone'];
    if (typeof v.audience === 'string' && /^user:[A-Za-z0-9_.-]{1,80}$/.test(v.audience)) {
      change.audience = [v.audience];
    }
    if (typeof v.enabled === 'boolean') change.enabled = v.enabled;
    return { skillId: idOf(v.skillId), action, change };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ report?: { passed: number; total: number } }>(
        getRequest(),
        data.action === 'change'
          ? `/v1/skills/${data.skillId}`
          : `/v1/skills/${data.skillId}/${data.action}`,
        data.action === 'change' ? data.change : {},
        crypto.randomUUID(),
      ),
    ),
  );

export const keepConversationAsSkill = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const id = text((input as { conversationId?: unknown } | null)?.conversationId, 80);
    if (!/^cnv_[0-9a-f-]{8,64}$/.test(id)) throw new Error('Which conversation?');
    return { conversationId: id };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ skill: StoredSkill }>(
        getRequest(),
        `/v1/assistant/conversations/${data.conversationId}/skill`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );
