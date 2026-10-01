import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi } from '@/platform/api';
import { env } from '@/platform/env';

export interface GatewayScreen {
  /** The MCP address to add to a copilot. */
  address: string;
  calls: { callId: string; client: string | null; tool: string; createdAt: string }[];
}

/** The gateway's address, and the person's latest calls through it (spec 006). */
export const fetchGateway = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GatewayScreen> => {
    const { calls } = await callApi<{ calls: GatewayScreen['calls'] }>(
      getRequest(),
      '/v1/gateway/calls',
    );
    return { address: `${env.apiUrl}/mcp`, calls: calls.slice(0, 10) };
  },
);
