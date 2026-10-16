import { createFileRoute } from '@tanstack/react-router';
import { fetchProjectMoney } from '@/lib/project-money';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchThread, fetchThreads } from '@/lib/threads';
import { ThreadsScreen } from '@/lib/threads-view';

interface Search {
  fil?: string;
}

export const Route = createFileRoute('/fils')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.fil === 'string' && /^thr_[0-9A-Za-z_-]{8,70}$/.test(search.fil)
      ? { fil: search.fil }
      : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ fil: search.fil }),
  loader: async ({ deps }) => {
    const threads = await fetchThreads();
    // Without a thread named, the most recent of her objects' threads opens.
    const chosen = deps.fil ?? threads.find((t) => t.kind !== 'kete')?.id;
    const view = chosen ? await fetchThread({ data: { threadId: chosen } }) : null;
    const object = view?.thread.object;
    const money =
      object?.kind === 'project'
        ? ((await fetchProjectMoney({ data: { projectId: object.id } }))?.money ?? null)
        : null;
    return { threads: threads.filter((t) => t.kind !== 'kete'), view, money };
  },
  component: ThreadsPage,
});

/** The threads (doctrine D-057, spec 090): the conversation in the middle, the state beside it. */
function ThreadsPage() {
  const { me } = Route.useRouteContext();
  const { threads, view, money } = Route.useLoaderData();
  return (
    <AppShell me={me} current="threads" bleed>
      <ThreadsScreen threads={threads} view={view} money={money} me={me.userId} />
    </AppShell>
  );
}
