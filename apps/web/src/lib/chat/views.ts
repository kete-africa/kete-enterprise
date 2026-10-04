import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Json } from '@/lib/workspace';
import { env } from '@/platform/env';

// The team's apps' views in the chat (spec 030, MCP Apps): their pages, read by the API from each
// app with her token, and the calls a view makes, relayed by the API with her token too.

/** Where the views run: the API's sandbox, on another origin than these screens. */
export const fetchViewSandbox = createServerFn({ method: 'GET' }).handler(() => ({
  url: `${env.publicApiUrl}/views/sandbox`,
}));

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** A view's page. */
export const fetchView = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { resource: text(v.resource, 80), uri: text(v.uri, 300) };
  })
  .handler(({ data }) =>
    callApi<{ html: string }>(
      getRequest(),
      `/v1/views?resource=${encodeURIComponent(data.resource)}&uri=${encodeURIComponent(data.uri)}`,
    ),
  );

/** A call the view makes (tools/call), with her token: her own gesture. */
export const callView = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      resource: text(v.resource, 80),
      name: text(v.name, 64),
      arguments:
        v.arguments && typeof v.arguments === 'object' && !Array.isArray(v.arguments)
          ? (v.arguments as Record<string, unknown>)
          : {},
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ [key: string]: Json }>(
      getRequest(),
      '/v1/views/call',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, result: answer.data, error: null }
      : { ok: false as const, result: null, error: answer.error };
  });
