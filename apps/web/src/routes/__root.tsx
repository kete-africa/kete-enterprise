import { themeFromCookies } from '@kete/design';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import type { ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import appCss from '@/styles/app.css?url';

/** The mode the person chose (spec 019), read before the page is drawn: no flash. */
const readTheme = createServerFn({ method: 'GET' }).handler(() =>
  themeFromCookies(getRequest().headers.get('cookie')),
);

export const Route = createRootRoute({
  loader: () => readTheme(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: m.app_name() },
      { name: 'description', content: m.meta_description() },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  const theme = Route.useLoaderData();
  return (
    <html lang={getLocale()} data-design="workspace" {...(theme ? { 'data-theme': theme } : {})}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
