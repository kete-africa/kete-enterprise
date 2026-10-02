import { KeteMark, Panel } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchLink } from '@/lib/admin';
import { LinkPage } from '@/lib/link-pages';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/lien/$token')({
  loader: ({ params }) => fetchLink({ data: { token: params.token } }),
  component: LinkRoute,
});

/**
 * A personal link (spec 010): no account, no menu — the person sees only what the link was sent
 * for, then goes. A wrong, expired or revoked link says so, and nothing else.
 */
function LinkRoute() {
  const link = Route.useLoaderData();
  const { token } = Route.useParams();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center gap-3">
        <KeteMark />
        <span className="font-semibold">{m.app_name()}</span>
      </header>
      {link ? (
        <LinkPage link={link} token={token} />
      ) : (
        <Panel title={m.link_invalid_title()}>
          <p>{m.link_invalid()}</p>
        </Panel>
      )}
    </main>
  );
}
