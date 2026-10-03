import type { CapabilityTool } from '@kete/capabilities';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { jsonSchema } from 'ai';
import { transaction } from '../../platform/db.js';
import { registryFor } from '../registry/index.js';

/**
 * The tools of the team's apps, for the person's assistant (spec 018): every active app or MCP
 * server of the registry she may see, with an https address, is asked for its tools with her own
 * token — so each app applies its own rights and autonomy, never more than hers. A tool is named
 * after its app; an app that does not answer within a few seconds is left out of this turn.
 */
export async function appToolsFor(
  identity: Parameters<typeof registryFor>[1] & { organizationId: string },
  token: string,
): Promise<{ tools: CapabilityTool[]; close: () => Promise<void> }> {
  const resources = await transaction(identity.organizationId, async (db) =>
    (await registryFor(db, identity)).resources.filter(
      (r) =>
        (r.kind === 'app' || r.kind === 'mcp') &&
        r.status === 'active' &&
        r.address?.startsWith('https://') &&
        (r.tier.kind !== 'personal' || r.ownerUserId === identity.userId),
    ),
  );
  const clients: Client[] = [];
  const found = await Promise.all(
    resources.map(async (resource) => {
      const base = (resource.address ?? '').replace(/\/$/, '');
      const endpoint = new URL(base.endsWith('/mcp') ? base : `${base}/mcp`);
      const client = new Client({ name: 'kete-enterprise', version: '1' });
      try {
        await withTimeout(
          client.connect(
            new StreamableHTTPClientTransport(endpoint, {
              requestInit: { headers: { authorization: `Bearer ${token}` } },
            }) as unknown as Parameters<Client['connect']>[0],
          ),
        );
        clients.push(client);
        const listed = await withTimeout(client.listTools());
        const prefix = slug(resource.name);
        return listed.tools.map((remote): CapabilityTool => ({
          name: `${prefix}__${remote.name}`.slice(0, 64),
          description: `[${resource.name}] ${remote.description ?? remote.name}`,
          // The app describes its input in JSON Schema; the model reads it as is.
          input: jsonSchema(remote.inputSchema as never) as never,
          jsonSchema: remote.inputSchema as Record<string, unknown>,
          autonomy: 1,
          execute: async (input) => {
            const result = await client.callTool({
              name: remote.name,
              arguments: (input ?? {}) as Record<string, unknown>,
            });
            return {
              status: 'done',
              output: result.structuredContent ?? result.content,
            };
          },
        }));
      } catch {
        return [];
      }
    }),
  );
  return {
    tools: found.flat(),
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
    },
  };
}

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 24) || 'app'
  );
}

function withTimeout<T>(work: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
