import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi } from '@/platform/api';

// « Comment ? » (spec 056), as the API serves it: how an agent did a task, from what was recorded.

export interface HowStep {
  tool: string;
  status: string;
  permission?: string;
  level?: number;
  sources?: { label: string; href: string }[];
}

export interface How {
  taskId: string;
  instruction: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  agent: { agentId: string; name: string };
  askedBy: { kind: 'person'; reader: boolean } | { kind: 'agents'; names: string[] };
  askedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: HowStep[];
  gestures: { at: string; command: string; summary: string | null; reversible: boolean }[];
  draftCount: number;
  error: string | null;
  rights: { permissions: string[]; autonomyMax: number };
}

export const fetchHow = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const id = (input as { taskId?: unknown } | null)?.taskId;
    if (typeof id !== 'string' || !/^tsk_[0-9A-Za-z_-]{4,64}$/.test(id)) {
      throw new Error('Which task?');
    }
    return { taskId: id };
  })
  .handler(({ data }) => callApi<How>(getRequest(), `/v1/agents/tasks/${data.taskId}/how`));
