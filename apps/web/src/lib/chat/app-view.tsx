import { AppRenderer } from '@mcp-ui/client';
import { useEffect, useState } from 'react';
import type { AppView as View } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { callView, fetchView } from './views';

/** The theme these screens show now, for the view to follow it. */
const theme = (): 'light' | 'dark' => {
  const chosen = document.documentElement.dataset['theme'];
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * An app's view in the chat (spec 030, MCP Apps), drawn by mcp-ui's host: the page its app serves,
 * in the API's sandbox (a double frame on another origin), with its tool's input and result. What
 * the view asks — deciding a draft, filling a form — goes through the API with her own token.
 */
export function AppView({ view, sandboxUrl }: { view: View; sandboxUrl: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetchView({ data: { resource: view.resource, uri: view.uri } })
      .then((page) => live && setHtml(page.html))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [view.resource, view.uri]);
  if (failed) return <p className="text-body-sm text-fg-muted">{m.view_failed()}</p>;
  if (!html) return <p className="text-body-sm text-fg-muted">{m.view_loading()}</p>;
  const result = view.result;
  return (
    <section
      aria-label={m.view_label({ app: view.tool.split('__')[0] ?? view.tool })}
      className="overflow-hidden rounded-box border border-line bg-surface"
    >
      <AppRenderer
        toolName={view.tool}
        html={html}
        sandbox={{ url: new URL(sandboxUrl) }}
        toolInput={view.input}
        toolResult={{
          content: [{ type: 'text', text: JSON.stringify(result ?? {}) }],
          ...(result && typeof result === 'object' && !Array.isArray(result)
            ? { structuredContent: result as Record<string, unknown> }
            : {}),
        }}
        hostInfo={{ name: 'Kete Enterprise', version: '1' }}
        hostContext={{ theme: theme(), locale: getLocale(), displayMode: 'inline' }}
        onCallTool={async (params) => {
          const answer = await callView({
            data: {
              resource: view.resource,
              name: params.name,
              arguments: (params.arguments ?? {}) as Record<string, unknown>,
            },
          });
          if (!answer.ok || !answer.result) {
            return {
              content: [{ type: 'text', text: answer.error ?? 'failed' }],
              isError: true,
            };
          }
          return answer.result as never;
        }}
        onOpenLink={async ({ url }) => {
          if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
          return {};
        }}
        onError={() => setFailed(true)}
      />
    </section>
  );
}
