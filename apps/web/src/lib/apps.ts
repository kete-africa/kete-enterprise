import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi } from '@/platform/api';

// « Apps » (spec 070): what stands behind the center for the person, and what it gives the center.

export interface AppEntry {
  kind: 'pack' | 'app' | 'connector';
  key: string;
  name: string | null;
  href: string | null;
  external: boolean;
  receives: { waiting: number; tools: number; watch: boolean; reads: string | null };
}

export const fetchApps = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ apps: AppEntry[] }>(getRequest(), '/v1/apps'),
);
