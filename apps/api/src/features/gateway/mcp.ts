import type { SqlExecutor } from '@kete/tenancy';
import type { Actor } from '@kete/commands';
import {
  createCapabilityRegistry,
  createMcpHandler,
  protectedResourceMetadata,
  type CapabilityTool,
  type InvocationResult,
} from '@kete/capabilities';
import { actingPerson, asPerson } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { identityOf } from '../../platform/identity.js';
import { VERSION } from '../../platform/service.js';
import { notificationWords } from '../notifications/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import { ruleAgainst, type Rule } from '../rules/index.js';
import { GATEWAY_PERMISSION, gatewayCapabilities } from './capabilities.js';
import { recordCall } from './infrastructure/gateway.tables.js';

/**
 * The gateway's capabilities: the same rights, journal and autonomy rules as the screens. A call
 * is allowed for the person it acts for, in her organization only.
 */
const registry = createCapabilityRegistry(gatewayCapabilities, {
  authorize: async (caller, permission) => {
    const acting = actingPerson();
    if (!acting || acting.organizationId !== caller.organizationId) return false;
    // The person herself (deciding a draft), or an agent acting for her.
    const forHer =
      caller.actor.onBehalfOf?.id === acting.userId ||
      (caller.actor.kind === 'person' && caller.actor.id === acting.userId);
    if (!forHer) return false;
    if (permission === GATEWAY_PERMISSION) return true;
    // A business permission: the agent holds it only where the person does (spec 017).
    return transaction(caller.organizationId, async (db) =>
      reachesAnything(await reach(db, acting, permission)),
    );
  },
  transaction,
});

/** A capability an organization's rule refused: nothing ran, and the rule is named. */
export type RuleRefusal = InvocationResult & { rule: { ruleId: string; sentence: string } };

const refusedBy = (rule: Rule): RuleRefusal => ({
  status: 'refused',
  reason: 'not_allowed',
  rule: { ruleId: rule.ruleId, sentence: rule.sentence },
});

/**
 * The organization's rules for its agents (spec 068, D-043), at their single point of passage:
 * every tool an agent is given asks the rules before it runs. An active rule that covers it
 * refuses — journaled with the rule — and nothing runs; a rule on trial only counts.
 */
function ruled(
  organizationId: string,
  actor: Actor,
  tools: readonly CapabilityTool[],
  permissionOf: ReadonlyMap<string, string>,
): CapabilityTool[] {
  return tools.map((tool) => ({
    ...tool,
    async execute(input: unknown) {
      const rule = await transaction(organizationId, (db) =>
        ruleAgainst(db, organizationId, {
          actor,
          tool: tool.name,
          permission: permissionOf.get(tool.name) ?? '',
          autonomy: tool.autonomy,
        }),
      );
      return rule ? refusedBy(rule) : tool.execute(input);
    },
  }));
}

/** The drafts an agent may hold open for one person at once: beyond, it waits (D-028). */
export const DRAFT_BUDGET = 10;

/**
 * The person's capabilities as model tools, for Kete's own assistant (spec 014): the same registry,
 * the same rights, an agent acting on her behalf. Call it, and the tools, inside `asPerson`.
 */
export async function toolsForPerson(identity: { organizationId: string; userId: string }) {
  const actor: Actor = {
    kind: 'agent',
    id: 'agt_assistant',
    channel: 'chat',
    onBehalfOf: { kind: 'person', id: identity.userId },
  };
  const tools = ruled(
    identity.organizationId,
    actor,
    await registry.tools({ organizationId: identity.organizationId, actor }),
    await toolPermissions(identity.organizationId, actor),
  );
  // A draft beyond the budget is not prepared: too many validations and people stop reading.
  return tools.map((tool) =>
    tool.autonomy < 3
      ? tool
      : {
          ...tool,
          execute: async (input: unknown) =>
            (await openDraftsFor(identity)) >= DRAFT_BUDGET
              ? // Beyond the budget the agent is not allowed to prepare more: it waits for her decisions.
                ({ status: 'refused', reason: 'not_allowed' } as const)
              : tool.execute(input),
        },
  );
}

/** Each capability's permission by its tool's name, as the caller sees them (spec 056). */
export async function toolPermissions(
  organizationId: string,
  actor: Actor,
): Promise<Map<string, string>> {
  return new Map(
    (await registry.list({ organizationId, actor })).map((c) => [c.name, c.permission]),
  );
}

/**
 * An agent's tools for a task given to it (spec 036): its person's capabilities — the same
 * registry, her rights — narrowed to its job description: the permissions it lists, its highest
 * autonomy level, its budget of open drafts. Call it, and the tools, inside `asPerson`.
 */
export async function toolsForAgent(
  person: { organizationId: string; userId: string },
  actor: Actor,
  limits: {
    permissions: string[];
    autonomyMax: number;
    /** Its level per permission, never above its maximum (spec 052). */
    autonomyByPermission?: Record<string, number>;
    draftBudget: number;
  },
) {
  const caller = { organizationId: person.organizationId, actor };
  const allowed = new Set(limits.permissions);
  const permissionOf = new Map(
    (await registry.list(caller)).map((capability) => [capability.name, capability.permission]),
  );
  // A tool within the level its kind of task allows: its permission's, else the agent's maximum.
  const levelOf = (permission: string) =>
    Math.min(limits.autonomyMax, limits.autonomyByPermission?.[permission] ?? limits.autonomyMax);
  const tools = (await registry.tools(caller)).filter((tool) => {
    const permission = permissionOf.get(tool.name) ?? '';
    return (
      tool.autonomy <= levelOf(permission) &&
      (allowed.has(permission) || permission === GATEWAY_PERMISSION)
    );
  });
  return ruled(person.organizationId, actor, tools, permissionOf).map((tool) =>
    tool.autonomy < 3
      ? tool
      : {
          ...tool,
          execute: async (input: unknown) =>
            (await openDraftsOf(person, actor.id)) >= limits.draftBudget
              ? // Its budget spent, the agent waits for her decisions before preparing more.
                ({ status: 'refused', reason: 'not_allowed' } as const)
              : tool.execute(input),
        },
  );
}

async function openDraftsOf(identity: { organizationId: string; userId: string }, agentId: string) {
  return transaction(identity.organizationId, async (db) => {
    const { rows } = await db.query<{ count: string }>(
      `select count(*) from kete_drafts
        where status = 'prepared' and on_behalf_of_id = $1 and prepared_by_id = $2`,
      [identity.userId, agentId],
    );
    return Number(rows[0]?.count ?? 0);
  });
}

async function openDraftsFor(identity: { organizationId: string; userId: string }) {
  return transaction(identity.organizationId, async (db) => {
    const { rows } = await db.query<{ count: string }>(
      `select count(*) from kete_drafts
        where status = 'prepared' and on_behalf_of_id = $1 and prepared_by_id = 'agt_assistant'`,
      [identity.userId],
    );
    return Number(rows[0]?.count ?? 0);
  });
}

function personCaller(identity: { organizationId: string; userId: string }) {
  return {
    organizationId: identity.organizationId,
    actor: { kind: 'person' as const, id: identity.userId, channel: 'web' as const },
  };
}

/** The drafts prepared for this person, waiting for her decision, as she reviews them. */
export async function draftsFor(identity: { organizationId: string; userId: string }) {
  const ids = await transaction(identity.organizationId, async (db) => {
    const { rows } = await db.query<{ draft_id: string }>(
      `select draft_id from kete_drafts
        where status = 'prepared' and on_behalf_of_id = $1 order by created_at desc limit 50`,
      [identity.userId],
    );
    return rows.map((r) => r.draft_id);
  });
  const caller = personCaller(identity);
  const reviews = await Promise.all(ids.map((id) => registry.review(caller, id)));
  return reviews.filter((r) => r !== null);
}

/** How many drafts wait for her decision: the count beside « À faire » (spec 046). */
export async function preparedDraftCount(db: SqlExecutor, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `select count(*) as count from kete_drafts where status = 'prepared' and on_behalf_of_id = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** The person decides a draft from her screen: the same command, journaled with her as actor. */
export function decideDraft(
  identity: { organizationId: string; userId: string },
  draftId: string,
  decision: { action: 'validate' | 'refuse'; reason?: string | undefined },
) {
  const base = { ...personCaller(identity), draftId, idempotencyKey: `draft-${draftId}` };
  return registry.decide(
    decision.action === 'validate'
      ? { ...base, action: 'validate' }
      : { ...base, action: 'refuse', reason: decision.reason ?? 'refused' },
  );
}

/** Where the gateway answers, as copilots reach it. */
function resourceUrl(request: Request): string {
  return `${env.publicApiUrl || new URL(request.url).origin}/mcp`;
}

/** Where MCP clients learn that the identity issues this gateway's tokens (RFC 9728). */
export function gatewayResourceMetadata(request: Request): Response {
  return protectedResourceMetadata({
    resource: resourceUrl(request),
    authorizationServers: [env.accountUrl],
    // offline_access: the copilot keeps its access without asking the person every 15 minutes.
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  })();
}

/**
 * A copilot's calls through the MCP gateway meet the same rules: when one of the tools it calls
 * is refused by a rule, none of the calls of the body runs, and each is answered with the rule.
 */
async function refusedCalls(
  identity: { organizationId: string; userId: string },
  body: string,
  tools: string[],
): Promise<Response | null> {
  const actor: Actor = {
    kind: 'agent',
    id: 'agt_gateway',
    channel: 'mcp',
    onBehalfOf: { kind: 'person', id: identity.userId },
  };
  const offered = new Map(
    (await registry.tools({ organizationId: identity.organizationId, actor })).map((tool) => [
      tool.name,
      tool,
    ]),
  );
  const permissionOf = await toolPermissions(identity.organizationId, actor);
  let refusing: Rule | null = null;
  for (const name of tools) {
    const tool = offered.get(name);
    if (!tool) continue;
    const rule = await transaction(identity.organizationId, (db) =>
      ruleAgainst(db, identity.organizationId, {
        actor,
        tool: name,
        permission: permissionOf.get(name) ?? '',
        autonomy: tool.autonomy,
      }),
    );
    refusing ??= rule;
  }
  if (!refusing) return null;
  const parsed: unknown = JSON.parse(body);
  const text = notificationWords().ruleRefused(refusing.sentence);
  const answers = (Array.isArray(parsed) ? parsed : [parsed])
    .filter(
      (message): message is { id: string | number; method: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { method?: unknown }).method === 'tools/call' &&
        (message as { id?: unknown }).id !== undefined,
    )
    .map((message) => ({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text }], isError: true },
    }));
  return Response.json(Array.isArray(parsed) ? answers : (answers[0] ?? {}));
}

/** The tools a JSON-RPC body calls: the gateway traces each one. */
function toolsCalled(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body);
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    return messages
      .filter(
        (m): m is { method: string; params?: { name?: unknown } } =>
          typeof m === 'object' &&
          m !== null &&
          (m as { method?: unknown }).method === 'tools/call' &&
          // A retry carrying the person's answer (MCP 2026-07-28) is the same call, traced once.
          !(m as { params?: { inputResponses?: unknown } }).params?.inputResponses,
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
    // A draft is put to the person in her copilot's form when it can show one (MCP 2026-07-28);
    // otherwise, and for level 4, her To do is the way back.
    draftUrl: () => `${env.publicWebUrl}/a-faire`,
  });
  if (!identity) return handler(request);
  // The body is read once, for the trace, and handed on as it came.
  const body = request.method === 'POST' ? await request.text() : null;
  const tools = body ? toolsCalled(body) : [];
  if (tools.length > 0) {
    const client = request.headers.get('user-agent')?.slice(0, 200) ?? null;
    await transaction(identity.organizationId, async (db) => {
      for (const tool of tools) {
        await recordCall(db, identity.organizationId, { userId: identity.userId, client, tool });
      }
    });
  }
  const forwarded =
    body === null
      ? request
      : new Request(request.url, { method: request.method, headers: request.headers, body });
  return asPerson(identity, async () => {
    const refused = body && tools.length > 0 ? await refusedCalls(identity, body, tools) : null;
    return refused ?? handler(forwarded);
  });
}
