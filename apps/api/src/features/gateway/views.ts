import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { env } from '../../platform/env.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { appClient } from './federation.js';

// The team's apps' views in the chat (spec 030, MCP Apps, doctrine D-037): the host reads a view's
// page from its app, and relays the calls the view makes — with the person's own token, so that
// she, not the model, is the one who decides in a view.

type Ctx = Context<{ Variables: IdentityVariables }>;

const resourceId = z.string().min(1).max(80);
const viewUri = z
  .string()
  .max(300)
  .regex(/^ui:\/\/[\w./-]+$/);

/** Her own token, never an administrator's viewing her space. */
function herToken(c: Ctx): string {
  if (c.get('viewedBy')) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Views open in her own space only.');
  }
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) throw new GestureRefusal(403, 'forbidden', 'A token is required.');
  return token;
}

/** The views of the apps, under /v1/views. */
export const viewRoutes = new Hono<{ Variables: IdentityVariables }>()
  // A view's page, as its app serves it (resources/read).
  .get('/', async (c) => {
    const resource = resourceId.safeParse(c.req.query('resource'));
    const uri = viewUri.safeParse(c.req.query('uri'));
    if (!resource.success || !uri.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Which app, which view?');
    }
    const client = await appClient(c.get('identity'), herToken(c), resource.data).catch(() => null);
    if (!client) throw new GestureRefusal(404, 'not_found', 'No such app for her.');
    try {
      const read = await client.readResource({ uri: uri.data });
      const content = read.contents.find((x) => x.uri === uri.data) ?? read.contents[0];
      const html = content && 'text' in content ? String(content.text) : null;
      if (!html) throw new GestureRefusal(404, 'not_found', 'The app has no such view.');
      return c.json({ html });
    } finally {
      await client.close().catch(() => undefined);
    }
  })
  // A call a view makes (tools/call): her gesture, with her own token — a draft decided in a
  // view is decided by her (D-037).
  .post('/call', async (c) => {
    const parsed = z
      .object({
        resource: resourceId,
        name: z.string().min(1).max(64),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Which tool?');
    const client = await appClient(c.get('identity'), herToken(c), parsed.data.resource).catch(
      () => null,
    );
    if (!client) throw new GestureRefusal(404, 'not_found', 'No such app for her.');
    try {
      const result = await client.callTool({
        name: parsed.data.name,
        arguments: parsed.data.arguments,
      });
      return c.json(result, 201);
    } finally {
      await client.close().catch(() => undefined);
    }
  });

/**
 * The sandbox proxy (MCP Apps' double iframe): served by the API, on another origin than the
 * screens, it receives a view's page from the screens and runs it in an inner frame, relaying its
 * messages. Adapted from the MCP Apps reference host (modelcontextprotocol/ext-apps, basic-host).
 * The page requests nothing: no network, no other origin.
 */
export function viewSandbox(): Response {
  const host = env.publicWebUrl ? new URL(env.publicWebUrl).origin : '';
  const script = `
const HOST = ${JSON.stringify(host)};
const DEV = /^http:\\/\\/(localhost|127\\.0\\.0\\.1)(:|\\/|$)/;
if (window.self === window.top) throw new Error('Only inside the host.');
const referrer = document.referrer ? new URL(document.referrer).origin : '';
const EXPECTED = HOST || (DEV.test(referrer) ? referrer : '');
if (!EXPECTED || referrer !== EXPECTED) throw new Error('Embedding site not allowed.');
const OWN = window.location.origin;
const inner = document.createElement('iframe');
inner.style = 'width:100%;height:100%;border:none';
inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
document.body.appendChild(inner);
window.addEventListener('message', (event) => {
  if (event.source === window.parent) {
    if (event.origin !== EXPECTED) return;
    if (event.data && event.data.method === 'ui/notifications/sandbox-resource-ready') {
      const { html, sandbox } = event.data.params || {};
      if (typeof sandbox === 'string') inner.setAttribute('sandbox', sandbox);
      if (typeof html === 'string') {
        const doc = inner.contentDocument || (inner.contentWindow && inner.contentWindow.document);
        if (doc) { doc.open(); doc.write(html); doc.close(); } else { inner.srcdoc = html; }
      }
    } else if (inner.contentWindow) {
      inner.contentWindow.postMessage(event.data, '*');
    }
  } else if (event.source === inner.contentWindow) {
    if (event.origin !== OWN) return;
    window.parent.postMessage(event.data, EXPECTED);
  }
});
window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, EXPECTED);
`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Kete view</title><style>html,body{margin:0;height:100vh;width:100vw;background:transparent}body{display:flex;flex-direction:column}iframe{flex-grow:1;background:transparent;color-scheme:inherit}</style></head><body><script>${script}</script></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The views are self-contained: no request leaves them, whatever they contain.
      'content-security-policy': [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        'img-src data: blob:',
        'font-src data:',
        "connect-src 'none'",
        "frame-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${host || 'http://localhost:* http://127.0.0.1:*'}`,
      ].join('; '),
    },
  });
}
