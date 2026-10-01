import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';

/** Every call through the gateway, with row-level security in the same migration. */
export function gatewayMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.gateway_calls (
  call_id text primary key,
  organization_id text not null,
  user_id text not null,
  client text,
  tool text not null,
  created_at timestamptz not null default now()
);
create index gateway_calls_user on ${s}.gateway_calls (organization_id, user_id, created_at desc);
${organizationPolicySql({ schema: s, table: 'gateway_calls', appRole: options.appRole })}
-- The trace is append-only: nobody changes or deletes a call.
grant select, insert on ${s}.gateway_calls to ${options.appRole};
`;
}

export interface GatewayCall {
  callId: string;
  client: string | null;
  tool: string;
  createdAt: string;
}

export async function recordCall(
  db: SqlExecutor,
  organizationId: string,
  call: { userId: string; client: string | null; tool: string },
): Promise<void> {
  await db.query(
    `insert into gateway_calls (call_id, organization_id, user_id, client, tool)
     values ($1, $2, $3, $4, $5)`,
    [newId('gwc'), organizationId, call.userId, call.client, call.tool],
  );
}

export async function callsOf(db: SqlExecutor, userId: string): Promise<GatewayCall[]> {
  const { rows } = await db.query<{
    call_id: string;
    client: string | null;
    tool: string;
    created_at: Date;
  }>(
    `select call_id, client, tool, created_at from gateway_calls where user_id = $1
      order by created_at desc limit 100`,
    [userId],
  );
  return rows.map((row) => ({
    callId: row.call_id,
    client: row.client,
    tool: row.tool,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** The trace stays append-only whatever a schema's default privileges give (spec 006). */
export function gatewayAppendOnlySql(options: { schema: string; appRole: string }): string {
  return `
revoke all on ${options.schema}.gateway_calls from ${options.appRole};
grant select, insert on ${options.schema}.gateway_calls to ${options.appRole};
`;
}
