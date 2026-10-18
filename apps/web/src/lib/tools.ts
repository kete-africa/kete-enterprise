import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Imported tools (spec 093): the organization's own tools — described by OpenAPI, or served by a
// remote MCP server — given to its agents under Kete's rules: a read alone, an act as a draft
// someone decides, a destruction confirmed.

export type ToolEffect = 'read' | 'act' | 'destroy';

export interface ToolSet {
  setId: string;
  kind: 'openapi' | 'mcp';
  prefix: string;
  label: string;
  address: string;
  baseUrl: string | null;
  hasSecret: boolean;
  status: 'active' | 'off';
  tools: { name: string; description: string; effect: ToolEffect }[];
  createdAt: string;
}

export const fetchToolSets = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ sets: ToolSet[] }> => callApi<{ sets: ToolSet[] }>(getRequest(), '/v1/tools'),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const importToolSet = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const secret = typeof v.secret === 'string' ? v.secret.slice(0, 4000) : '';
    const baseUrl = text(v.baseUrl, 400);
    return {
      kind: v.kind === 'mcp' ? ('mcp' as const) : ('openapi' as const),
      label: text(v.label, 80),
      prefix: text(v.prefix, 16).toLowerCase(),
      address: text(v.address, 400),
      ...(baseUrl && v.kind !== 'mcp' ? { baseUrl } : {}),
      ...(secret ? { secret } : {}),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ set: ToolSet }>(
      getRequest(),
      '/v1/tools',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });

export const setToolSetStatus = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { setId?: unknown; status?: unknown };
    if (typeof v.setId !== 'string' || !/^tls_[0-9a-f-]{8,64}$/.test(v.setId)) {
      throw new Error('Unknown.');
    }
    if (v.status !== 'active' && v.status !== 'off') throw new Error('Unknown.');
    return { setId: v.setId, status: v.status as 'active' | 'off' };
  })
  .handler(({ data }) =>
    sendGesture<{ status: string }>(
      getRequest(),
      `/v1/tools/${data.setId}/status`,
      { status: data.status },
      crypto.randomUUID(),
    ),
  );
