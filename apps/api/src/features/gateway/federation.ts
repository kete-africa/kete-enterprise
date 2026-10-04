import type { CapabilityTool } from '@kete/capabilities';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { jsonSchema } from 'ai';
import { transaction } from '../../platform/db.js';
import { tokenForAgent, type Agent } from '../../platform/mandates.js';
import { registryFor } from '../registry/index.js';

/** The assistant, as the apps know it when it carries a person's mandate (spec 024). */
export const ASSISTANT: Agent = { id: 'agt_assistant', name: 'Assistant Kete Enterprise' };

let appFetch: typeof fetch | undefined;

/** Tests: reach the apps another way (an app served in memory). */
export function useAppFetch(next: typeof fetch | undefined): void {
  appFetch = next;
}

/** The view an app's tool names (MCP Apps `_meta.ui`), and who may call the tool. */
function uiOf(meta: unknown): { resourceUri: string | null; forModel: boolean } {
  const ui = (meta as { ui?: { resourceUri?: unknown; visibility?: unknown } } | undefined)?.ui;
  const uri = typeof ui?.resourceUri === 'string' && ui.resourceUri.startsWith('ui://');
  const visibility = Array.isArray(ui?.visibility) ? (ui.visibility as unknown[]) : null;
  return {
    resourceUri: uri ? (ui?.resourceUri as string) : null,
    // A tool for the view only (`visibility: ["app"]`) — deciding a draft — never reaches the
    // model: the person decides in the view (doctrine D-037).
    forModel: visibility === null || visibility.includes('model'),
  };
}

/** A connected MCP client to one of her apps, with the token given; null when it is not hers. */
export async function appClient(
  identity: Parameters<typeof registryFor>[1] & { organizationId: string },
  token: string,
  resourceId: string,
): Promise<Client | null> {
  const resource = (await appsOf(identity)).find((r) => r.resourceId === resourceId);
  if (!resource) return null;
  const client = newClient();
  await withTimeout(client.connect(transportTo(resource.address ?? '', token)));
  return client;
}

/** The active apps and MCP servers of the registry she may see, with an https address. */
async function appsOf(identity: Parameters<typeof registryFor>[1] & { organizationId: string }) {
  return transaction(identity.organizationId, async (db) =>
    (await registryFor(db, identity)).resources.filter(
      (r) =>
        (r.kind === 'app' || r.kind === 'mcp') &&
        r.status === 'active' &&
        r.address?.startsWith('https://') &&
        (r.tier.kind !== 'personal' || r.ownerUserId === identity.userId),
    ),
  );
}

/**
 * A client to an app: it probes for the 2026-07-28 revision and falls back to the 2025 one, as
 * the team's apps move at their own pace (spec 039).
 */
const newClient = () =>
  new Client({ name: 'kete-enterprise', version: '1' }, { versionNegotiation: { mode: 'auto' } });

function transportTo(address: string, token: string): Parameters<Client['connect']>[0] {
  const base = address.replace(/\/$/, '');
  const endpoint = new URL(base.endsWith('/mcp') ? base : `${base}/mcp`);
  return new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    ...(appFetch ? { fetch: appFetch } : {}),
  });
}

/**
 * The tools of the team's apps, for the person's assistant (spec 018): every active app or MCP
 * server of the registry she may see, with an https address, is asked for its tools with her
 * mandate (spec 024) — or her own token while mandates are off — so each app applies its own
 * rights and autonomy, never more than hers. A tool is named after its app; an app that does not
 * answer within a few seconds is left out of this turn.
 */
export async function appToolsFor(
  identity: Parameters<typeof registryFor>[1] & { organizationId: string },
  personToken: string,
  agent: Agent = ASSISTANT,
): Promise<{
  tools: CapabilityTool[];
  /** The view a tool of an app shows with its result, and the app it comes from (MCP Apps). */
  viewOf: (toolName: string) => { resourceId: string; uri: string } | null;
  close: () => Promise<void>;
}> {
  const views = new Map<string, { resourceId: string; uri: string }>();
  const viewOf = (toolName: string) => views.get(toolName) ?? null;
  const token = await tokenForAgent(personToken, agent);
  if (!token) return { tools: [], viewOf, close: async () => undefined };
  const resources = await appsOf(identity);
  const clients: Client[] = [];
  const found = await Promise.all(
    resources.map(async (resource) => {
      const client = newClient();
      try {
        await withTimeout(client.connect(transportTo(resource.address ?? '', token)));
        clients.push(client);
        const listed = await withTimeout(client.listTools());
        const prefix = slug(resource.name);
        return listed.tools.flatMap((remote): CapabilityTool[] => {
          const ui = uiOf(remote._meta);
          if (!ui.forModel) return [];
          const name = `${prefix}__${remote.name}`.slice(0, 64);
          if (ui.resourceUri) {
            views.set(name, { resourceId: resource.resourceId, uri: ui.resourceUri });
          }
          return [
            {
              name,
              description: `[${resource.name}] ${remote.description ?? remote.name}`,
              // The app describes its input in JSON Schema; the model reads it as is.
              input: jsonSchema(remote.inputSchema as never) as never,
              jsonSchema: remote.inputSchema as Record<string, unknown>,
              autonomy: 1,
              ...(ui.resourceUri ? { view: ui.resourceUri } : {}),
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
            },
          ];
        });
      } catch {
        return [];
      }
    }),
  );
  return {
    tools: found.flat(),
    viewOf,
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
