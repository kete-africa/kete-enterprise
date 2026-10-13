import type { Reading } from '../connectors.js';

// What an administrator starts from, per business tool: the reading of a well-known MCP server,
// to adjust to the server she installed. The connector itself knows no vendor: a preset is only a
// filled form.

export interface Preset {
  key: string;
  name: string;
  /** What to check on the server before connecting, as the form says it. */
  note: 'tool_names_vary';
  reading: Reading;
}

/**
 * Frappe (ERPNext): the purchase requests waiting for approval. Its community MCP servers do not
 * name their tools alike — `list_documents` here, `get_documents` or `frappe_search_docs`
 * elsewhere — so the tool's name and arguments are hers to adjust. `{site}` is her site's address.
 */
export const presets: Preset[] = [
  {
    key: 'frappe_purchase_requests',
    name: 'Frappe (ERPNext)',
    note: 'tool_names_vary',
    reading: {
      tool: 'list_documents',
      arguments: {
        doctype: 'Material Request',
        filters: { material_request_type: 'Purchase', workflow_state: 'Pending' },
        fields: ['name', 'title', 'approver'],
        limit: 50,
      },
      label: 'Demande d’achat',
      fields: { key: 'name', title: 'title', person: 'approver' },
      link: 'https://{site}/app/material-request/{key}',
    },
  },
];
