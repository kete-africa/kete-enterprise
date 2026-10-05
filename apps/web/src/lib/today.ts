import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import type { Card, Dashboard } from '@/lib/dashboards';
import { callApi } from '@/platform/api';

// « Aujourd'hui » (spec 046), as the API serves it.

export interface DayItem {
  kind: 'decision' | 'draft' | 'app_task' | 'form' | 'action' | 'note';
  id: string;
  title: string;
  source: string | null;
  dueAt: string | null;
  overdue: boolean;
  href: string;
  progress: { done: number; total: number } | null;
}

export interface DoneItem {
  taskId: string;
  agentName: string;
  instruction: string;
  status: 'done' | 'failed';
  answer: string | null;
  draftCount: number;
  finishedAt: string;
}

export interface Today {
  name: string;
  today: string;
  day: DayItem[];
  pinned: { dashboard: Dashboard; cards: Card[] }[];
  done: DoneItem[];
}

export const fetchToday = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Today>(getRequest(), '/v1/today'),
);
