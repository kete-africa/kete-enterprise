import {
  createCapabilityRegistry,
  createMcpHandler,
  protectedResourceMetadata,
} from '@kete/capabilities';
import { actingPerson, asPerson } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { identityOf } from '../../platform/identity.js';
import { VERSION } from '../../platform/service.js';
import { GATEWAY_PERMISSION, gatewayCapabilities } from './capabilities.js';
import { recordCall } from './infrastructure/gateway.tables.js';

/**
 * The gateway's capabilities: the same rights, journal and autonomy rules as the screens. A call
 * is allowed for the person it acts for, in her organization only.
 */
const registry = createCapabilityRegistry(gatewayCapabilities, {
  authorize: async (caller, permission) => {
    const acting = actingPerson();
    return (
      permission === GATEWAY_PERMISSION &&
      acting !== null &&
      acting.organizationId === caller.organizationId &&
      caller.actor.onBehalfOf?.id === acting.userId
    );
  },
  transaction,
});

/** Where the gateway answers, as copilots reach it. */
function resourceUrl(request: Request): string {
  return `${env.publicApiUrl || new URL(request.url).origin}/mcp`;
}

/** Where MCP clients learn that the identity issues this gateway's tokens (RFC 9728). */
export function gatewayResourceMetadata(request: Request): Response {
  return protectedResourceMetadata({
    resource: resourceUrl(request),
    authorizationServers: [env.accountUrl],
  })();
}

/** The tools a JSON-RPC body calls: the gateway traces each one. */
async function toolsCalled(request: Request): Promise<string[]> {
  if (request.method !== 'POST') return [];
  try {
    const body: unknown = await request.clone().json();
    const messages = Array.isArray(body) ? body : [body];
    return messages
      .filter(
        (m): m is { method: string; params?: { name?: unknown } } =>
          typeof m === 'object' &&
          m !== null &&
          (m as { method?: unknown }).method === 'tools/call',
      )
      .map((m) => (typeof m.params?.name === 'string' ? m.params.name : 'unknown'));
  } catch {
    return [];
  }
}

/**
 * The MCP gateway (spec 006): one address, and for each person only what her rights let her see.
 * Her copilot acts as an agent on her behalf; every tool call is traced.
 */
export async function handleGateway(request: Request): Promise<Response> {
  const identity = await identityOf(request);
  const handler = createMcpHandler({
    registry,
    server: { name: 'kete-enterprise', version: VERSION },
    caller: async () =>
      identity
        ? {
            organizationId: identity.organizationId,
            actor: {
              kind: 'agent',
              id: 'agt_gateway',
              channel: 'mcp',
              onBehalfOf: { kind: 'person', id: identity.userId },
            },
          }
        : null,
    resourceMetadataUrl: `${new URL(resourceUrl(request)).origin}/.well-known/oauth-protected-resource`,
  });
  if (!identity) return handler(request);
  const tools = await toolsCalled(request);
  if (tools.length > 0) {
    const client = request.headers.get('user-agent')?.slice(0, 200) ?? null;
    await transaction(identity.organizationId, async (db) => {
      for (const tool of tools) {
        await recordCall(db, identity.organizationId, { userId: identity.userId, client, tool });
      }
    });
  }
  return asPerson(identity, () => handler(request));
}
