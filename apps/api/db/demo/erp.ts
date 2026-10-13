import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import { z } from 'zod';
import { useConnectorFetch } from '../../src/features/connectors/index.js';

// The demo has no ERP: this one is written in advance (step C9). It answers like the MCP server
// of an ERP would — a list of purchase requests waiting for approval — so that a connector can be
// tried, connected and read on the screens. It proves the connector, never a real ERP.

/** The purchase requests waiting in the demo's ERP, for one approver. */
const waitingFor = (approver: string) => [
  { name: 'MAT-MR-2026-00041', title: 'Huit batteries 200 Ah — site de Bè', approver },
  { name: 'MAT-MR-2026-00042', title: 'Câbles solaires 6 mm², 300 m', approver },
  { name: 'MAT-MR-2026-00043', title: 'Onduleur 5 kVA', approver: 'achats@ailleurs.example' },
];

/**
 * Serves the demo's ERP in memory, and adds its connector — on trial: the administrator tries it,
 * connects it, reads it.
 */
export async function seedErp(options: {
  api: Hono;
  admin: string;
  /** The e-mail of the person the requests wait for, as the structure knows her. */
  approver: string;
}): Promise<boolean> {
  const waiting = waitingFor(options.approver);
  const erp = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'erp-demo', version: '1' });
      server.registerTool(
        'list_documents',
        {
          description: 'Lists the documents of a doctype.',
          inputSchema: z.object({ doctype: z.string() }).loose(),
          annotations: { readOnlyHint: true },
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(waiting) }],
          structuredContent: { data: waiting },
        }),
      );
      return server;
    },
    { responseMode: 'json' },
  );
  useConnectorFetch((async (url: string | URL | Request, init?: RequestInit) =>
    erp.fetch(new Request(url, init))) as typeof fetch);
  const added = await options.api.request('/v1/connectors', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.admin}`,
      'content-type': 'application/json',
      'idempotency-key': 'demo-erp-connector',
    },
    body: JSON.stringify({
      name: 'ERP de démonstration',
      address: 'https://erp.demo.example',
      reading: {
        tool: 'list_documents',
        arguments: { doctype: 'Material Request', filters: { workflow_state: 'Pending' } },
        label: 'Demande d’achat',
        fields: { key: 'name', title: 'title', person: 'approver' },
        link: 'https://erp.demo.example/app/material-request/{key}',
      },
    }),
  });
  return added.status < 300;
}
