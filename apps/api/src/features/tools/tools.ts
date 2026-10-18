import type { CapabilityDefinition } from '@kete/capabilities';
import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import {
  callMcp,
  callOpenApi,
  connectMcp,
  toolCapabilities,
  ToolError,
  toolsFromMcp,
  toolsFromOpenApi,
  type ImportedTool,
} from '@kete/tools';
import { z } from 'zod';
import { open, seal, secretsOn } from '../../platform/secrets.js';
import { allowed, toolsFetch } from './infrastructure/public-fetch.js';

// Imported tools (spec 093, kete-core spec 124): the organization's own tools — its CRM described
// by OpenAPI, its ticketing served by a remote MCP server — given to its agents under Kete's
// rules. A read runs alone; an act is a draft a person decides; a destruction needs her
// confirmation. An administrator imports a set; what it holds is read once and kept, so an agent
// never meets a tool nobody saw; its key is sealed and never returned.

export const TOOLS_READ = 'tools:read';
export const TOOLS_ACT = 'tools:act';
export const toolsPermissions = [TOOLS_READ, TOOLS_ACT] as const;

export function toolsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.imported_tool_sets (
  organization_id text not null,
  set_id text not null,
  kind text not null check (kind in ('openapi', 'mcp')),
  -- Every tool of the set is named after it: crm_contacts_list.
  prefix text not null check (prefix ~ '^[a-z][a-z0-9]{1,15}$'),
  label text not null check (length(label) between 1 and 80),
  -- The OpenAPI description's address, or the MCP server's.
  address text not null check (address like 'https://%'),
  -- Where an OpenAPI set's calls go.
  base_url text check (base_url like 'https://%'),
  -- The tools as they were read at the import: what an agent is given, nothing else.
  tools jsonb not null,
  -- Its key, sealed (AES-256-GCM): never returned, never logged.
  secret_sealed text,
  status text not null check (status in ('active', 'off')),
  created_by text not null,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  primary key (organization_id, set_id),
  unique (organization_id, prefix)
);
${organizationPolicySql({ schema: s, table: 'imported_tool_sets', appRole: options.appRole })}
grant select, insert, update on ${s}.imported_tool_sets to ${options.appRole};
`;
}

export type ToolSetKind = 'openapi' | 'mcp';

/** A set as an administrator reads it: its tools and their effect, never its key. */
export interface ToolSet {
  setId: string;
  kind: ToolSetKind;
  prefix: string;
  label: string;
  address: string;
  baseUrl: string | null;
  hasSecret: boolean;
  status: 'active' | 'off';
  tools: { name: string; description: string; effect: ImportedTool['effect'] }[];
  createdAt: string;
}

type Row = {
  set_id: string;
  kind: ToolSetKind;
  prefix: string;
  label: string;
  address: string;
  base_url: string | null;
  tools: ImportedTool[];
  secret_sealed: string | null;
  status: 'active' | 'off';
  created_at: Date;
};
const COLUMNS = `set_id, kind, prefix, label, address, base_url, tools, secret_sealed, status,
  created_at`;

const setOf = (r: Row): ToolSet => ({
  setId: r.set_id,
  kind: r.kind,
  prefix: r.prefix,
  label: r.label,
  address: r.address,
  baseUrl: r.base_url,
  hasSecret: r.secret_sealed !== null,
  status: r.status,
  tools: r.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    effect: tool.effect,
  })),
  createdAt: r.created_at.toISOString(),
});

export async function listToolSets(db: SqlExecutor): Promise<ToolSet[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from imported_tool_sets order by status, label`,
  );
  return rows.map(setOf);
}

export class ToolSetError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'prefix_taken'
      | 'tool_name_taken'
      | 'secrets_off'
      | 'not_public'
      | 'unreachable'
      | 'invalid_description'
      | 'no_tools',
    message: string,
  ) {
    super(message);
    this.name = 'ToolSetError';
  }
}

export const importToolsInput = z.object({
  kind: z.enum(['openapi', 'mcp']),
  label: z.string().trim().min(1).max(80),
  prefix: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9]{1,15}$/),
  /** The OpenAPI description (JSON), or the MCP server. */
  address: z.string().trim().url().startsWith('https://').max(400),
  /** Where an OpenAPI set's calls go, when its description does not say it. */
  baseUrl: z.string().trim().url().startsWith('https://').max(400).optional(),
  /** Its key, sent as a bearer token; sealed at once. */
  secret: z.string().min(1).max(4000).optional(),
});

/** The names already taken by the product's own capabilities: an import never shadows one. */
let reserved: ReadonlySet<string> = new Set();
export function reserveToolNames(names: Iterable<string>): void {
  reserved = new Set(names);
}

const auth = (secret: string | null) =>
  secret ? { header: 'authorization', value: `Bearer ${secret}` } : undefined;

/** Reads what a set holds, at its address, over the public internet only. */
async function readTools(
  input: z.output<typeof importToolsInput>,
): Promise<{ tools: ImportedTool[]; baseUrl: string | null }> {
  if (!(await allowed(input.address))) {
    throw new ToolSetError('not_public', 'This address is not on the public internet.');
  }
  if (input.kind === 'mcp') {
    const client = await connectMcp(input.address, {
      ...(input.secret ? { token: input.secret } : {}),
      fetch: toolsFetch,
    }).catch(() => {
      throw new ToolSetError('unreachable', 'Its server did not answer.');
    });
    try {
      return { tools: await toolsFromMcp(client, { prefix: input.prefix }), baseUrl: null };
    } catch {
      throw new ToolSetError('unreachable', 'Its server did not list its tools.');
    } finally {
      await client.close().catch(() => undefined);
    }
  }
  const credential = auth(input.secret ?? null);
  const response = await toolsFetch(input.address, {
    headers: {
      accept: 'application/json',
      ...(credential ? { [credential.header]: credential.value } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) throw new ToolSetError('unreachable', 'Its description did not come.');
  const text = await response.text();
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new ToolSetError('invalid_description', 'Its description is not JSON.');
  }
  let tools: ImportedTool[];
  try {
    tools = toolsFromOpenApi(document, { prefix: input.prefix });
  } catch (error) {
    throw new ToolSetError(
      'invalid_description',
      error instanceof ToolError ? error.message : 'Its description is not OpenAPI 3.',
    );
  }
  // Where its calls go: what the administrator said, else its first server, read from its address.
  const server = (document as { servers?: { url?: unknown }[] }).servers?.[0]?.url;
  const said =
    input.baseUrl ?? (typeof server === 'string' ? new URL(server, input.address).href : null);
  if (!said?.startsWith('https://')) {
    throw new ToolSetError('invalid_description', 'Say where its calls go (https).');
  }
  return { tools, baseUrl: said };
}

/** A set is imported: its tools are read once, kept, and given to agents at once. */
export const importTools = defineCommand({
  name: 'import-tools',
  input: importToolsInput,
  reversibility: { reversible: true, inverse: 'set-tool-set-status' },
  // Its key never enters the journal.
  journalInput: false,
  async handler(input, { db, organizationId, actor }) {
    if (input.secret && !secretsOn()) {
      throw new ToolSetError('secrets_off', 'This instance keeps no secret.');
    }
    const taken = await db.query('select 1 from imported_tool_sets where prefix = $1', [
      input.prefix,
    ]);
    if (taken.rows.length > 0) throw new ToolSetError('prefix_taken', 'This prefix is taken.');
    const { tools, baseUrl } = await readTools(input);
    if (tools.length === 0) throw new ToolSetError('no_tools', 'It offers no tool.');
    if (tools.some((tool) => reserved.has(tool.name))) {
      throw new ToolSetError('tool_name_taken', 'One of its tools has the name of one of Kete’s.');
    }
    const { rows } = await db.query<Row>(
      `insert into imported_tool_sets (organization_id, set_id, kind, prefix, label, address,
         base_url, tools, secret_sealed, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10) returning ${COLUMNS}`,
      [
        organizationId,
        newId('tls'),
        input.kind,
        input.prefix,
        input.label,
        input.address,
        baseUrl,
        JSON.stringify(tools),
        input.secret ? seal(input.secret) : null,
        actor.id,
      ],
    );
    return setOf(rows[0] as Row);
  },
  summarize: (input, output) => `Tools imported: ${input.label} (${output.tools.length})`,
});

export const toolSetStatusInput = z.object({
  setId: z.string().regex(/^tls_[0-9a-f-]{8,64}$/),
  status: z.enum(['active', 'off']),
});

/** A set is turned off — its tools leave every agent at once — or back on. */
export const setToolSetStatus = defineCommand({
  name: 'set-tool-set-status',
  input: toolSetStatusInput,
  reversibility: { reversible: true, inverse: 'set-tool-set-status' },
  async handler(input, { db }) {
    const { rows } = await db.query<{ label: string }>(
      `update imported_tool_sets set status = $2, changed_at = now()
        where set_id = $1 returning label`,
      [input.setId, input.status],
    );
    if (!rows[0]) throw new ToolSetError('not_found', 'No such set here.');
    return { setId: input.setId, label: rows[0].label, status: input.status };
  },
  summarize: (_input, output) => `Tools ${output.status}: ${output.label}`,
});

/** What the organization's sets are now: the key under which its capabilities are kept. */
export async function toolSetsVersion(db: SqlExecutor): Promise<string> {
  const { rows } = await db.query<{ version: string | null }>(
    `select string_agg(set_id || ':' || status || ':' || extract(epoch from changed_at), ',' order by set_id)
       as version from imported_tool_sets`,
  );
  return rows[0]?.version ?? '';
}

/** Calls one tool of a set, server-side, with its key, over the public internet only. */
async function callTool(row: Row, tool: ImportedTool, input: Record<string, unknown>) {
  const secret = row.secret_sealed ? open(row.secret_sealed) : null;
  if (!(await allowed(row.kind === 'mcp' ? row.address : (row.base_url ?? '')))) {
    throw new ToolError('unreachable', 'This address is not on the public internet.');
  }
  if (row.kind === 'openapi') {
    const credential = auth(secret);
    return callOpenApi(tool, input, {
      baseUrl: row.base_url ?? '',
      ...(credential ? { credential } : {}),
      fetch: toolsFetch,
    });
  }
  const client = await connectMcp(row.address, {
    ...(secret ? { token: secret } : {}),
    fetch: toolsFetch,
  });
  try {
    return await callMcp(client, tool, input);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * The active sets' tools as capabilities: a read under `tools:read` at level 1, an act under
 * `tools:act` as a draft (level 3), a destruction at level 4 — registered beside the gateway's
 * own, with the same gesture, policies and journal.
 */
export async function importedCapabilities(db: SqlExecutor): Promise<CapabilityDefinition[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from imported_tool_sets where status = 'active' order by prefix`,
  );
  return rows.flatMap((row) =>
    toolCapabilities(row.tools, {
      permissions: { read: TOOLS_READ, act: TOOLS_ACT },
      call: (tool, input) => callTool(row, tool, input),
    }),
  );
}
