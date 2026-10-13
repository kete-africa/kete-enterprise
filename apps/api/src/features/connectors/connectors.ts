import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { open, seal, secretsOn } from '../../platform/secrets.js';
import { readChartAt } from '../structure/index.js';
import { closeTask, openTasksFrom, putTask } from '../workspace/index.js';

// Connectors (spec 069): a business tool the organization already has — its ERP — reached through
// its MCP server, to READ what waits for a person there and put it in her « Décider ». A
// connector calls one tool, the one its administrator named, and nothing else: it never writes,
// its tools are never given to an agent, and its credential is sealed and never returned. It is
// tried before it is connected: the trial says what it would file, and for whom.

export function connectorsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.connectors (
  organization_id text not null,
  connector_id text not null,
  name text not null check (length(name) between 1 and 80),
  address text not null check (address like 'https://%'),
  -- Its credential, sealed (AES-256-GCM): never returned, never logged.
  secret_sealed text,
  -- What it reads: the tool, its arguments, and where a row says its key, its title, its person.
  reading jsonb not null,
  status text not null check (status in ('trial', 'connected', 'off')),
  -- When it was last tried: it is not connected before.
  tried_at timestamptz,
  last_read_at timestamptz,
  last_error text,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, connector_id),
  unique (organization_id, name)
);
${organizationPolicySql({ schema: s, table: 'connectors', appRole: options.appRole })}
grant select, insert, update on ${s}.connectors to ${options.appRole};

create function ${s}.connectors_connected() returns table (organization_id text, connector_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, connector_id from connectors where status = 'connected' $$;
revoke all on function ${s}.connectors_connected() from public;
grant execute on function ${s}.connectors_connected() to ${options.appRole};
`;
}

/** What a connector reads, and how a row becomes something that waits for a person. */
export const readingInput = z.object({
  /** The server's tool that lists what waits. */
  tool: z.string().trim().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).default({}),
  /** What one of them is called, as she will read it: « Demande d'achat ». */
  label: z.string().trim().min(1).max(60),
  fields: z.object({
    /** The row's identifier in the tool: one task per key. */
    key: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(80),
    /** The e-mail of the person it waits for: matched with the structure's. */
    person: z.string().trim().min(1).max(80),
  }),
  /** Where she opens it, `{key}` replaced: the tool's own page. */
  link: z.string().trim().url().startsWith('https://').max(400),
});
export type Reading = z.output<typeof readingInput>;

export type ConnectorStatus = 'trial' | 'connected' | 'off';

export interface Connector {
  connectorId: string;
  name: string;
  address: string;
  /** Whether a credential is kept — never the credential. */
  hasSecret: boolean;
  reading: Reading;
  status: ConnectorStatus;
  triedAt: string | null;
  lastReadAt: string | null;
  lastError: string | null;
}

type Row = {
  connector_id: string;
  name: string;
  address: string;
  secret_sealed: string | null;
  reading: Reading;
  status: ConnectorStatus;
  tried_at: Date | null;
  last_read_at: Date | null;
  last_error: string | null;
};
const COLUMNS = `connector_id, name, address, secret_sealed, reading, status, tried_at,
  last_read_at, last_error`;
const connectorOf = (r: Row): Connector => ({
  connectorId: r.connector_id,
  name: r.name,
  address: r.address,
  hasSecret: r.secret_sealed !== null,
  reading: r.reading,
  status: r.status,
  triedAt: r.tried_at?.toISOString() ?? null,
  lastReadAt: r.last_read_at?.toISOString() ?? null,
  lastError: r.last_error,
});

export async function listConnectors(db: SqlExecutor): Promise<Connector[]> {
  const { rows } = await db.query<Row>(`select ${COLUMNS} from connectors order by name`);
  return rows.map(connectorOf);
}

async function find(db: SqlExecutor, connectorId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from connectors where connector_id = $1`,
    [connectorId],
  );
  return rows[0] ?? null;
}

export class ConnectorError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'not_tried'
      | 'name_taken'
      | 'secrets_off'
      | 'unreachable'
      | 'no_such_tool'
      | 'not_read_only'
      | 'unreadable',
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const createConnectorInput = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().url().startsWith('https://').max(400),
  /** Its credential, sent as a bearer token; sealed at once. */
  secret: z.string().min(1).max(2000).optional(),
  reading: readingInput,
});

/** A connector is added: on trial, it reads nothing by itself yet. */
export const createConnector = defineCommand({
  name: 'create-connector',
  input: createConnectorInput,
  reversibility: { reversible: true, inverse: 'set-connector-status' },
  // Its credential never enters the journal.
  journalInput: false,
  async handler(input, { db, organizationId, actor }) {
    if (input.secret && !secretsOn()) {
      throw new ConnectorError('secrets_off', 'This instance keeps no secret.');
    }
    const taken = await db.query('select 1 from connectors where name = $1', [input.name]);
    if (taken.rows.length > 0) throw new ConnectorError('name_taken', 'This name is taken.');
    const { rows } = await db.query<Row>(
      `insert into connectors (organization_id, connector_id, name, address, secret_sealed,
         reading, status, created_by)
       values ($1, $2, $3, $4, $5, $6, 'trial', $7) returning ${COLUMNS}`,
      [
        organizationId,
        newId('cnr'),
        input.name,
        input.address,
        input.secret ? seal(input.secret) : null,
        JSON.stringify(input.reading),
        actor.id,
      ],
    );
    return connectorOf(rows[0] as Row);
  },
  summarize: (input) => `Connector on trial: ${input.name}`,
});

export const connectorStatusInput = z.object({
  connectorId: z.string().regex(/^cnr_[0-9a-f-]{8,64}$/),
  status: z.enum(['connected', 'off']),
});

/** A connector is connected — only once it was tried — or switched off. */
export const setConnectorStatus = defineCommand({
  name: 'set-connector-status',
  input: connectorStatusInput,
  reversibility: { reversible: true, inverse: 'set-connector-status' },
  async handler(input, { db }) {
    const row = await find(db, input.connectorId);
    if (!row) throw new ConnectorError('not_found', 'No such connector here.');
    if (input.status === 'connected' && !row.tried_at) {
      throw new ConnectorError('not_tried', 'Try it before connecting it.');
    }
    await db.query('update connectors set status = $2 where connector_id = $1', [
      input.connectorId,
      input.status,
    ]);
    return { connectorId: row.connector_id, name: row.name, status: input.status };
  },
  summarize: (input, output) => `Connector ${output.status}: ${output.name}`,
});

let connectorFetch: typeof fetch | undefined;

/** Tests: reach a connector's server another way (a server in memory). */
export function useConnectorFetch(next: typeof fetch | undefined): void {
  connectorFetch = next;
}

const timed = <T>(work: Promise<T>, ms = 8000): Promise<T> =>
  Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

/** The rows a tool's answer holds: its structured content, or the JSON its text is. */
function rowsOf(result: { structuredContent?: unknown; content?: unknown }): unknown[] | null {
  const list = (value: unknown): unknown[] | null => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'object' || value === null) return null;
    // The usual envelopes of a list.
    for (const name of ['data', 'documents', 'items', 'results', 'rows', 'result']) {
      const inner = (value as Record<string, unknown>)[name];
      if (Array.isArray(inner)) return inner;
    }
    return null;
  };
  const structured = list(result.structuredContent);
  if (structured) return structured;
  for (const part of Array.isArray(result.content) ? result.content : []) {
    const text = (part as { type?: unknown; text?: unknown }).text;
    if (typeof text !== 'string') continue;
    try {
      const parsed = list(JSON.parse(text));
      if (parsed) return parsed;
    } catch {
      // Not JSON: another part may be.
    }
  }
  return null;
}

/** What waits in the tool, as the connector read it: its key, its title, whose it is. */
interface Waiting {
  key: string;
  title: string;
  email: string;
}

/**
 * Calls the connector's one tool on its server and reads its rows. The tool must not declare
 * that it writes: a server that says its tool is not read-only, or destructive, is refused.
 */
async function waitingAt(row: Row): Promise<Waiting[]> {
  const base = row.address.replace(/\/$/, '');
  const secret = row.secret_sealed ? open(row.secret_sealed) : null;
  const client = new Client(
    { name: 'kete-enterprise', version: '1' },
    { versionNegotiation: { mode: 'auto' } },
  );
  try {
    await timed(
      client.connect(
        new StreamableHTTPClientTransport(new URL(base.endsWith('/mcp') ? base : `${base}/mcp`), {
          ...(secret ? { requestInit: { headers: { authorization: `Bearer ${secret}` } } } : {}),
          ...(connectorFetch ? { fetch: connectorFetch } : {}),
        }),
      ),
    );
  } catch {
    throw new ConnectorError('unreachable', 'Its server did not answer.');
  }
  try {
    const { tools } = await timed(client.listTools());
    const tool = tools.find((candidate) => candidate.name === row.reading.tool);
    if (!tool) throw new ConnectorError('no_such_tool', 'Its server has no such tool.');
    if (tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true) {
      throw new ConnectorError('not_read_only', 'Its server says this tool writes.');
    }
    const result = await timed(
      client.callTool({ name: row.reading.tool, arguments: row.reading.arguments }),
    );
    const rows = result.isError ? null : rowsOf(result);
    if (!rows) throw new ConnectorError('unreadable', 'Its answer is not a list.');
    const { fields } = row.reading;
    return rows.flatMap((entry): Waiting[] => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const key = record[fields.key];
      const title = record[fields.title];
      const email = record[fields.person];
      if (typeof key !== 'string' && typeof key !== 'number') return [];
      return [
        {
          key: String(key).slice(0, 200),
          title: typeof title === 'string' ? title.slice(0, 200) : '',
          email: typeof email === 'string' ? email.trim().toLowerCase() : '',
        },
      ];
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ReadReport {
  /** What waits in the tool. */
  found: number;
  /** Filed in the « Décider » of the person it waits for. */
  filed: { key: string; title: string; person: string }[];
  /** Waiting for someone the structure does not know by this e-mail. */
  unmatched: { key: string; email: string }[];
  /** No longer waiting there: taken out of her « Décider ». */
  closed: number;
}

/**
 * Reads what waits in the tool. `file`: puts each one in the « Décider » of the person it waits
 * for — matched by e-mail with the structure — and takes out what no longer waits. Without it,
 * a trial: it says what it would file, and writes nothing but the date it was tried.
 */
export async function readConnector(
  db: SqlExecutor,
  organizationId: string,
  connectorId: string,
  options: { file: boolean },
): Promise<ReadReport> {
  const row = await find(db, connectorId);
  if (!row) throw new ConnectorError('not_found', 'No such connector here.');
  const waiting = await waitingAt(row).catch((error: unknown) => {
    throw error instanceof ConnectorError
      ? error
      : new ConnectorError('unreachable', 'Its server did not answer.');
  });
  const chart = await readChartAt(db, new Date().toISOString().slice(0, 10));
  const byEmail = new Map(
    chart.people
      .filter((person) => person.email && person.accountUserId)
      .map((person) => [(person.email ?? '').toLowerCase(), person]),
  );
  const report: ReadReport = { found: waiting.length, filed: [], unmatched: [], closed: 0 };
  const kept = new Set<string>();
  for (const item of waiting) {
    const person = byEmail.get(item.email);
    if (!person?.accountUserId) {
      report.unmatched.push({ key: item.key, email: item.email });
      continue;
    }
    report.filed.push({ key: item.key, title: item.title, person: person.name });
    kept.add(`${person.accountUserId}\n${item.key}`);
    if (!options.file) continue;
    await putTask(db, organizationId, person.accountUserId, {
      source: row.name,
      key: item.key,
      title: `${row.reading.label} ${item.key}${item.title ? ` : ${item.title}` : ''}`.slice(
        0,
        300,
      ),
      href: row.reading.link.replace('{key}', encodeURIComponent(item.key)),
    });
  }
  if (options.file) {
    // Decided in the tool, it no longer waits there: it leaves her « Décider ».
    for (const task of await openTasksFrom(db, row.name)) {
      if (kept.has(`${task.userId}\n${task.key}`)) continue;
      if (await closeTask(db, task.userId, { source: row.name, key: task.key })) report.closed += 1;
    }
  }
  await db.query(
    `update connectors
        set tried_at = coalesce(tried_at, now()), last_error = null,
            last_read_at = case when $2 then now() else last_read_at end
      where connector_id = $1`,
    [connectorId, options.file],
  );
  return report;
}

/** Why its last reading failed, kept on the connector — in a transaction of its own. */
export async function noteFailure(
  db: SqlExecutor,
  connectorId: string,
  code: ConnectorError['code'],
): Promise<void> {
  await db.query('update connectors set last_error = $2 where connector_id = $1', [
    connectorId,
    code,
  ]);
}

/** The connected connectors of every organization, each read in its own (the worker's round). */
export async function readConnected(
  pool: SqlExecutor,
  inOrganization: <T>(organizationId: string, work: (db: SqlExecutor) => Promise<T>) => Promise<T>,
): Promise<number> {
  const { rows } = await pool.query<{ organization_id: string; connector_id: string }>(
    'select organization_id, connector_id from connectors_connected()',
  );
  for (const row of rows) {
    // One connector's failure never stops the others: its error is kept on it.
    await inOrganization(row.organization_id, (db) =>
      readConnector(db, row.organization_id, row.connector_id, { file: true }),
    ).catch((error: unknown) =>
      inOrganization(row.organization_id, (db) =>
        noteFailure(
          db,
          row.connector_id,
          error instanceof ConnectorError ? error.code : 'unreachable',
        ),
      ).catch(() => undefined),
    );
  }
  return rows.length;
}
