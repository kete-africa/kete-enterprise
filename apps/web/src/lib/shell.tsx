import {
  applyTheme,
  Button,
  CommandPalette,
  CommandTrigger,
  CountBadge,
  Icon,
  Menu,
  NavItem,
  NavSection,
  Shell,
  TabBar,
  TabBarItem,
  ThemeChoice,
  useCommandShortcut,
  type CommandGroup,
  type IconName,
  type ThemeChoiceValue,
} from '@kete/design';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { administers, opens, viewAs, type Me } from './me';
import { AssistantPanel, useShownPage } from './chat/panel';
import { searchEverywhere, type SearchResult } from './notifications';

/** Where a screen sits: the person's space, or the Administration (spec 010). */
export type Page =
  | 'home'
  | 'todo'
  | 'assistant'
  | 'resources'
  | 'notifications'
  | 'search'
  | 'library'
  | 'dossiers'
  | 'documents'
  | 'skills'
  | 'datasets'
  | 'forms'
  | 'dashboards'
  | 'admin_templates'
  | 'admin_library'
  | 'my_agents'
  | 'surveys'
  | 'performance'
  | 'team'
  | 'meetings'
  | 'compliance'
  | 'admin'
  | 'organization'
  | 'people'
  | 'rights'
  | 'modules'
  | 'circuits'
  | 'registry'
  | 'agents'
  | 'outbox'
  | 'ai'
  | 'demo'
  | 'all';

const adminPages: Page[] = [
  'admin',
  'organization',
  'people',
  'rights',
  'modules',
  'circuits',
  'registry',
  'agents',
  'outbox',
  'ai',
  'demo',
];

/** A place of the space: where it leads, its icon, its name. */
export interface Place {
  page: Page;
  href: string;
  icon: IconName;
  label: string;
  group: 'me' | 'tools';
}

/**
 * Every place her modules and rights open (spec 046): the sidebar shows the first ones, « Tout »
 * and the palette all of them.
 */
export function placesOf(me: Me): Place[] {
  const all: (Place | false)[] = [
    { page: 'home', href: '/', icon: 'home', label: m.nav_today(), group: 'me' },
    { page: 'todo', href: '/a-faire', icon: 'check', label: m.nav_todo(), group: 'me' },
    {
      page: 'assistant',
      href: '/assistant',
      icon: 'sparkle',
      label: m.nav_assistant(),
      group: 'me',
    },
    me.modules.performance &&
      Boolean(me.personId) && {
        page: 'team',
        href: '/mon-equipe',
        icon: 'people',
        label: m.nav_team(),
        group: 'me',
      },
    me.modules.dossiers && {
      page: 'dossiers',
      href: '/dossiers',
      icon: 'folder',
      label: m.nav_dossiers(),
      group: 'me',
    },
    me.modules.agents && {
      page: 'my_agents',
      href: '/mes-agents',
      icon: 'agent',
      label: m.nav_my_agents(),
      group: 'me',
    },
    me.modules.dashboards && {
      page: 'dashboards',
      href: '/tableaux-de-bord',
      icon: 'chart',
      label: m.nav_dashboards(),
      group: 'me',
    },
    me.modules.forms && {
      page: 'forms',
      href: '/formulaires',
      icon: 'check',
      label: m.nav_forms(),
      group: 'me',
    },
    me.modules.datasets && {
      page: 'datasets',
      href: '/donnees',
      icon: 'table',
      label: m.nav_datasets(),
      group: 'me',
    },
    me.modules.documents && {
      page: 'documents',
      href: '/documents',
      icon: 'file',
      label: m.nav_documents(),
      group: 'me',
    },
    me.modules.skills && {
      page: 'skills',
      href: '/competences',
      icon: 'learn',
      label: m.nav_skills(),
      group: 'me',
    },
    me.modules.knowledge && {
      page: 'library',
      href: '/bibliotheque',
      icon: 'library',
      label: m.nav_library(),
      group: 'me',
    },
    { page: 'resources', href: '/ressources', icon: 'apps', label: m.nav_resources(), group: 'me' },
    {
      page: 'notifications',
      href: '/notifications',
      icon: 'bell',
      label: m.nav_notifications(),
      group: 'me',
    },
    opens(me, 'surveys', ['surveys:manage']) && {
      page: 'surveys',
      href: '/enquetes',
      icon: 'teach',
      label: m.nav_surveys(),
      group: 'tools',
    },
    opens(me, 'performance', [
      'performance:manage',
      'performance:measure',
      'performance:validate',
      'performance:read',
    ]) && {
      page: 'performance',
      href: '/performance',
      icon: 'chart',
      label: m.nav_performance(),
      group: 'tools',
    },
    opens(me, 'meetings', ['meetings:manage', 'meetings:publish']) && {
      page: 'meetings',
      href: '/instances',
      icon: 'calendar',
      label: m.nav_meetings(),
      group: 'tools',
    },
    opens(me, 'compliance', ['compliance:read', 'compliance:manage']) && {
      page: 'compliance',
      href: '/conformite',
      icon: 'flag',
      label: m.nav_compliance(),
      group: 'tools',
    },
  ];
  return all.filter((p): p is Place => Boolean(p));
}

/** What the sidebar always shows; the rest is under « Tout ». */
const primary: Page[] = ['home', 'todo', 'assistant', 'team', 'dossiers'];

/** The space: today, what waits, the assistant, her team, her dossiers — her apps, then « Tout ». */
function SpaceNav({ me, current }: { me: Me; current: Page }) {
  const places = placesOf(me).filter((p) => primary.includes(p.page));
  const elsewhere = !primary.includes(current) && !adminPages.includes(current);
  return (
    <>
      <NavSection>
        {places.map((p) => (
          <NavItem
            key={p.page}
            href={p.href}
            icon={p.icon}
            current={current === p.page}
            {...(p.page === 'todo' ? { count: me.waiting } : {})}
          >
            {p.label}
          </NavItem>
        ))}
      </NavSection>
      {me.apps.length > 0 && (
        <NavSection label={m.nav_team_apps()}>
          {me.apps.map((app) => (
            <NavItem key={app.resourceId} href={app.address} icon="apps" external>
              {app.name}
            </NavItem>
          ))}
        </NavSection>
      )}
      <div className="my-4 border-t border-line" />
      <NavSection>
        <NavItem href="/tout" icon="layers" current={current === 'all' || elsewhere}>
          {m.nav_all()}
        </NavItem>
      </NavSection>
    </>
  );
}

/** The Administration: the frame only — never a survey or a grid (spec 010). */
function AdminNav({ me, current }: { me: Me; current: Page }) {
  if (!adminPages.includes(current)) {
    return (
      <NavSection label={m.nav_administration()}>
        <NavItem href="/administration" icon="check">
          {m.nav_admin_home()}
        </NavItem>
      </NavSection>
    );
  }
  return (
    <NavSection label={m.nav_administration()}>
      <NavItem href="/administration" icon="apps" current={current === 'admin'}>
        {m.nav_admin_home()}
      </NavItem>
      <NavItem
        href="/administration/organisation"
        icon="library"
        current={current === 'organization'}
      >
        {m.nav_structure()}
      </NavItem>
      <NavItem href="/administration/personnes" icon="agent" current={current === 'people'}>
        {m.nav_people()}
      </NavItem>
      <NavItem href="/administration/droits" icon="check" current={current === 'rights'}>
        {m.nav_rights()}
      </NavItem>
      {me.administrator && (
        <NavItem href="/administration/modules" icon="apps" current={current === 'modules'}>
          {m.nav_modules()}
        </NavItem>
      )}
      <NavItem href="/administration/circuits" icon="arrow" current={current === 'circuits'}>
        {m.nav_circuits()}
      </NavItem>
      <NavItem href="/administration/registre" icon="library" current={current === 'registry'}>
        {m.nav_registry()}
      </NavItem>
      {me.modules.agents && (
        <NavItem href="/administration/agents" icon="agent" current={current === 'agents'}>
          {m.nav_agents()}
        </NavItem>
      )}
      {me.administrator && (
        <NavItem
          href="/administration/boite-de-test"
          icon="download"
          current={current === 'outbox'}
        >
          {m.nav_outbox()}
        </NavItem>
      )}
      {me.administrator && (
        <NavItem href="/administration/ia" icon="agent" current={current === 'ai'}>
          {m.nav_ai()}
        </NavItem>
      )}
      {me.administrator && me.modules.knowledge && (
        <NavItem
          href="/administration/bibliotheque"
          icon="library"
          current={current === 'admin_library'}
        >
          {m.nav_admin_library()}
        </NavItem>
      )}
      {me.administrator && me.modules.documents && (
        <NavItem
          href="/administration/modeles"
          icon="download"
          current={current === 'admin_templates'}
        >
          {m.nav_admin_templates()}
        </NavItem>
      )}
      {me.administrator && me.demo && (
        <NavItem href="/administration/demo" icon="learn" current={current === 'demo'}>
          {m.nav_demo()}
        </NavItem>
      )}
    </NavSection>
  );
}

/** Back to one's own space after viewing a demo person's. */
function ViewingBanner({ me }: { me: Me }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-control bg-state-info-surface px-4 py-3 text-body-sm text-state-info-fg">
      <span>{m.demo_viewing({ name: me.name })}</span>
      <Button
        variant="secondary"
        onClick={() => {
          void viewAs({ data: { personId: null } }).then(() => {
            window.location.href = '/administration/demo';
          });
        }}
      >
        {m.demo_back()}
      </Button>
    </div>
  );
}

const resultIcon: Record<SearchResult['kind'], IconName> = {
  conversation: 'sparkle',
  action: 'check',
  decision: 'flag',
  person: 'people',
  app: 'apps',
  document: 'file',
};

/**
 * Ctrl K (spec 046): one field to go somewhere, find something in Kete with her rights, or ask the
 * assistant — the question opens the assistant, which answers with its sources.
 */
function Palette({
  me,
  open,
  onOpenChange,
  onAsk,
}: {
  me: Me;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk: (question: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchEverywhere({ data: { q: query } })
        .then((answer) => setResults(answer.results))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);
  const groups: CommandGroup[] = [
    {
      heading: m.palette_results(),
      items: results.map((r, index) => ({
        id: `result-${index}`,
        label: r.title,
        ...(r.detail ? { hint: r.detail } : {}),
        icon: resultIcon[r.kind],
        // Found by the API: kept whatever words matched.
        keywords: [query],
        href: r.href,
      })),
    },
    {
      heading: m.palette_places(),
      items: [
        ...placesOf(me).map((p) => ({ id: p.page, label: p.label, icon: p.icon, href: p.href })),
        ...me.apps.map((a) => ({
          id: a.resourceId,
          label: a.name,
          icon: 'apps' as const,
          href: a.address,
        })),
        ...(administers(me)
          ? [
              {
                id: 'admin',
                label: m.nav_administration(),
                icon: 'tool' as const,
                href: '/administration',
              },
            ]
          : []),
      ],
    },
  ];
  return (
    <CommandPalette
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      label={m.palette_label()}
      placeholder={m.palette_placeholder()}
      emptyLabel={m.palette_empty()}
      query={query}
      onQueryChange={setQuery}
      groups={groups}
      ask={{
        heading: m.palette_ask(),
        label: (q) => m.palette_ask_item({ question: q }),
        onAsk: (q) => {
          onOpenChange(false);
          setQuery('');
          onAsk(q);
        },
      }}
    />
  );
}

/** A round icon link of the toolbar, with a count when something waits there. */
function ToolbarLink({
  href,
  label,
  icon,
  count,
}: {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
}) {
  return (
    <a
      href={href}
      aria-label={count ? `${label} (${count})` : label}
      title={label}
      className="relative inline-flex size-(--icon-button-size) items-center justify-center rounded-control text-fg hover:bg-surface-hover"
    >
      <Icon name={icon} />
      {count !== undefined && count > 0 && <CountBadge count={count} floating />}
    </a>
  );
}

/** The frame of every signed-in screen, in the workspace design (doctrine D-035, D-036; spec 046). */
export function AppShell({
  me,
  current,
  children,
}: {
  me: Me;
  current: Page;
  children: ReactNode;
}) {
  // The person's mode: dark, light or the device's own, kept in a cookie (spec 019).
  const [theme, setTheme] = useState<ThemeChoiceValue>('dark');
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  // The assistant beside the page (spec 048): what the page shows, a question from Ctrl K.
  const [panel, setPanel] = useState(false);
  const [question, setQuestion] = useState<{ text: string; at: number } | null>(null);
  const page = useShownPage();
  const closePanel = useCallback(() => setPanel(false), []);
  const ask = useCallback(
    (text: string) => {
      // On the assistant's own page, the question goes to its thread.
      if (current === 'assistant') {
        window.location.href = `/assistant?q=${encodeURIComponent(text)}`;
        return;
      }
      setQuestion({ text, at: Date.now() });
      setPanel(true);
    },
    [current],
  );
  useCommandShortcut(openPalette);
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark' || current === 'light' || current === 'auto') setTheme(current);
  }, []);
  return (
    <Shell
      brand={m.app_name()}
      footer={
        <ThemeChoice
          label={m.theme_label()}
          value={theme}
          onChange={(choice) => {
            setTheme(choice);
            applyTheme(choice);
          }}
          labels={{ dark: m.theme_dark(), light: m.theme_light(), auto: m.theme_auto() }}
        />
      }
      navLabel={m.nav_label()}
      showNavLabel={m.nav_show()}
      hideNavLabel={m.nav_hide()}
      search={<CommandTrigger label={m.palette_placeholder()} onOpen={openPalette} />}
      nav={
        <>
          <SpaceNav me={me} current={current} />
          {administers(me) && <AdminNav me={me} current={current} />}
        </>
      }
      toolbar={
        <div className="flex items-center gap-2">
          {current === 'assistant' ? (
            <ToolbarLink href="/assistant" label={m.nav_assistant()} icon="sparkle" />
          ) : (
            <button
              type="button"
              aria-label={m.nav_assistant()}
              title={m.nav_assistant()}
              aria-pressed={panel}
              onClick={() => setPanel((open) => !open)}
              className={`inline-flex size-(--icon-button-size) items-center justify-center rounded-control text-fg hover:bg-surface-hover ${
                panel ? 'bg-surface-selected' : ''
              }`}
            >
              <Icon name="sparkle" />
            </button>
          )}
          <ToolbarLink
            href="/notifications"
            label={m.nav_notifications()}
            icon="bell"
            count={me.unread}
          />
          <Menu label={me.name} items={[{ label: m.nav_sign_out(), href: '/auth/sortie' }]} />
        </div>
      }
      tabBar={
        <TabBar label={m.nav_tabs()}>
          <TabBarItem href="/" icon="home" current={current === 'home'}>
            {m.nav_today()}
          </TabBarItem>
          <TabBarItem href="/a-faire" icon="check" current={current === 'todo'} count={me.waiting}>
            {m.nav_todo()}
          </TabBarItem>
          <TabBarItem icon="sparkle" primary onClick={openPalette}>
            {m.nav_ask()}
          </TabBarItem>
          <TabBarItem href="/assistant" icon="agent" current={current === 'assistant'}>
            {m.nav_assistant()}
          </TabBarItem>
          <TabBarItem href="/tout" icon="menu" current={current === 'all'}>
            {m.nav_all()}
          </TabBarItem>
        </TabBar>
      }
    >
      {me.viewedBy && <ViewingBanner me={me} />}
      {children}
      <Palette me={me} open={palette} onOpenChange={setPalette} onAsk={ask} />
      {current !== 'assistant' && (
        <AssistantPanel open={panel} onClose={closePanel} page={page} question={question} />
      )}
    </Shell>
  );
}
