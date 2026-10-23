import { ThreadListPanel, type ListItem } from '@kete/conversation';
import { CanvasIcon } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AgentCatalogue, fetchCatalogue } from '@/lib/agent-catalogue';
import { NewAgent } from '@/lib/agents-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import {
  fetchAgentsScreen,
  fetchPeopleToAdd,
  fetchThread,
  fetchThreads,
  type AgentsScreen,
} from '@/lib/threads';
import { ThreadsScreen, threadsWords } from '@/lib/threads-view';
import * as m from '@/paraglide/messages.js';

interface Search {
  agent?: string;
  /** « Nouvel agent »: its job description from one sentence, in the middle. */
  nouveau?: boolean;
}

export const Route = createFileRoute('/mes-agents')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.agent === 'string' && /^agt_[0-9A-Za-z_-]{3,90}$/.test(search.agent)
      ? { agent: search.agent }
      : {}),
    ...(search.nouveau === 1 || search.nouveau === '1' || search.nouveau === true
      ? { nouveau: true }
      : {}),
  }),
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.modules.agents) throw redirect({ to: '/' });
    return context;
  },
  loaderDeps: ({ search }) => ({ agent: search.agent, nouveau: search.nouveau }),
  loader: async ({ deps }) => {
    const [screen, people, { threads, names }, catalogue] = await Promise.all([
      fetchAgentsScreen(),
      fetchPeopleToAdd(),
      fetchThreads(),
      fetchCatalogue(),
    ]);
    // The agent named, else the first as the list shows them: needs her, works, finished, idle.
    const rank = { needs: 0, working: 1, finished: 2, idle: 3 } as const;
    const chosen = deps.nouveau
      ? undefined
      : (screen.agents.find((a) => a.agentId === deps.agent) ??
        [...screen.agents].sort((a, b) => rank[a.state] - rank[b.state])[0]);
    const view = chosen ? await fetchThread({ data: { threadId: chosen.threadId } }) : null;
    return { screen, view, people, threads, names, catalogue, current: chosen?.threadId ?? null };
  },
  component: MyAgentsPage,
});

const order = ['needs', 'working', 'finished', 'idle'] as const;
const label = {
  needs: m.colleague_needs,
  working: m.colleague_working,
  finished: m.colleague_finished,
  idle: m.colleague_idle,
};

/** Her agents by state, then the threads they share with her (canvas v6.2, « Les agents »). */
function sectionsOf(screen: AgentsScreen) {
  const sections: { label: string; items: ListItem[] }[] = order
    .map((state) => ({
      label: label[state](),
      items: screen.agents
        .filter((a) => a.state === state)
        .map((a): ListItem => ({
          id: a.threadId,
          href: `/mes-agents?agent=${a.agentId}`,
          title: a.name,
          badge: { text: '', tone: 'agent' },
          last: a.line,
          unread: a.unread,
          state,
        })),
    }))
    .filter((section) => section.items.length > 0);
  if (screen.together.length > 0) {
    sections.push({
      label: m.colleague_together(),
      items: screen.together.map((t) => ({
        id: t.threadId,
        href: `/fils?fil=${t.threadId}`,
        title: t.title,
        badge: { text: '#', tone: 'group' },
        last: m.colleague_together_line({ agents: t.agents.join(', ') }),
      })),
    });
  }
  return sections;
}

/**
 * « Mes agents » (spec 099, FR-013 to FR-017): her agents by state on the left, the thread of one
 * of them in the middle — she gives it work by talking —, its job description at work beside it.
 * Every other setting is in « Tous ses réglages ».
 */
function MyAgentsPage() {
  const { me } = Route.useRouteContext();
  const { screen, view, people, threads, names, catalogue, current } = Route.useLoaderData();
  return (
    <AppShell me={me} current="my_agents" bleed>
      <ThreadsScreen
        threads={threads}
        names={names}
        view={view}
        money={null}
        me={me.userId}
        people={people}
        agents={{
          list: (
            <ThreadListPanel
              words={threadsWords()}
              current={current}
              hidden={Boolean(view)}
              sections={sectionsOf(screen)}
              top={
                <a
                  href="/mes-agents?nouveau=1"
                  className="inline-flex h-(--control-height) items-center justify-center gap-1.5 rounded-control border border-line-control bg-surface-control px-3 text-body-sm font-semibold hover:bg-surface-hover"
                >
                  <CanvasIcon name="plus" size={14} />
                  {m.colleague_new()}
                </a>
              }
            />
          ),
        }}
        empty={
          <div className="w-full max-w-[640px] text-left text-fg">
            {screen.agents.length === 0 && (
              <p className="mb-3 text-fg-muted">{m.colleague_none()}</p>
            )}
            <div className="grid gap-3">
              <AgentCatalogue entries={catalogue.entries} administrator={catalogue.administrator} />
              <NewAgent />
            </div>
          </div>
        }
      />
    </AppShell>
  );
}
