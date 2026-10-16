import { Button, FramePage, type CommandItem, type IconName } from '@kete/design';
import {
  AppFrame,
  type Place as ShellPlace,
  type PlaceSection,
  type ShellWords,
  type SyncState,
} from '@kete/shell';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { refusal } from '@/lib/forms';
import * as m from '@/paraglide/messages.js';
import { useAskBeside, useShownPage } from './chat/panel';
import { CenterIntelligence } from './intelligence';
import { administers, opens, viewAs, type Me } from './me';
import { NoteKept } from './note-composer';
import { writeNote } from './notes';
import { searchEverywhere, type SearchResult } from './notifications';
import { resolveShortcut } from './sidebar-nav';

/** Where a screen sits: the person's space, or the Administration (spec 010). */
export type Page =
  | 'home'
  | 'threads'
  | 'policies'
  | 'mailboxes'
  | 'todo'
  | 'assistant'
  | 'resources'
  | 'apps'
  | 'parties'
  | 'projects'
  | 'plan'
  | 'notifications'
  | 'search'
  | 'library'
  | 'dossiers'
  | 'documents'
  | 'skills'
  | 'datasets'
  | 'forms'
  | 'dashboards'
  | 'routines'
  | 'notebook'
  | 'requests'
  | 'field'
  | 'admin_templates'
  | 'admin_library'
  | 'my_agents'
  | 'reception'
  | 'phone'
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
  | 'rules'
  | 'connectors'
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
  'rules',
  'policies',
  'mailboxes',
  'connectors',
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
    {
      page: 'reception',
      href: '/mon-accueil',
      icon: 'people',
      label: m.nav_reception(),
      group: 'me',
    },
    {
      page: 'phone',
      href: '/mon-telephone',
      icon: 'people',
      label: m.nav_phone(),
      group: 'me',
    },
    {
      page: 'requests',
      href: '/demandes',
      icon: 'people',
      label: m.nav_requests(),
      group: 'me',
    },
    {
      page: 'notebook',
      href: '/carnet',
      icon: 'new',
      label: m.nav_notebook(),
      group: 'me',
    },
    {
      page: 'field',
      href: '/terrain',
      icon: 'tool',
      label: m.nav_field(),
      group: 'me',
    },
    {
      page: 'routines',
      href: '/routines',
      icon: 'refresh',
      label: m.nav_routines(),
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
    // The center's references (doctrine D-047): what she works on — the projects she belongs to.
    { page: 'projects', href: '/projets', icon: 'folder', label: m.nav_projects(), group: 'me' },
    // And who the organization works with.
    (me.administrator ||
      me.permissions.includes('parties:read') ||
      me.permissions.includes('parties:manage')) && {
      page: 'parties',
      href: '/tiers',
      icon: 'people',
      label: m.nav_parties(),
      group: 'me',
    },
    // What stands behind the center (spec 070): one door to every business tool.
    { page: 'apps', href: '/apps', icon: 'apps', label: m.nav_apps(), group: 'me' },
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

/** The Administration's places: the frame only — never a survey or a grid (spec 010). */
function adminPlaces(me: Me): ShellPlace[] {
  const all: (ShellPlace | false)[] = [
    { id: 'admin', label: m.nav_admin_home(), href: '/administration', icon: 'apps' },
    {
      id: 'organization',
      label: m.nav_structure(),
      href: '/administration/organisation',
      icon: 'library',
    },
    { id: 'people', label: m.nav_people(), href: '/administration/personnes', icon: 'agent' },
    { id: 'rights', label: m.nav_rights(), href: '/administration/droits', icon: 'check' },
    me.administrator && {
      id: 'modules',
      label: m.nav_modules(),
      href: '/administration/modules',
      icon: 'apps',
    },
    // One policy engine at the gesture (D-058, spec 088): the agents' rules and circuits are policies.
    me.administrator && {
      id: 'policies',
      label: m.nav_policies(),
      href: '/administration/politiques',
      icon: 'shield',
    },
    // The mailboxes the center reads, bridged into the threads (spec 089).
    me.administrator && {
      id: 'mailboxes',
      label: m.nav_mailboxes(),
      href: '/administration/boites-mail',
      icon: 'file',
    },
    me.administrator && {
      id: 'rules',
      label: m.nav_rules(),
      href: '/administration/regles',
      icon: 'check',
    },
    me.administrator && {
      id: 'connectors',
      label: m.nav_connectors(),
      href: '/administration/connecteurs',
      icon: 'apps',
    },
    {
      id: 'circuits',
      label: m.nav_circuits(),
      href: '/administration/circuits',
      icon: 'arrow',
    },
    {
      id: 'registry',
      label: m.nav_registry(),
      href: '/administration/registre',
      icon: 'library',
    },
    me.modules.agents && {
      id: 'agents',
      label: m.nav_agents(),
      href: '/administration/agents',
      icon: 'agent',
    },
    me.administrator && {
      id: 'outbox',
      label: m.nav_outbox(),
      href: '/administration/boite-de-test',
      icon: 'download',
    },
    me.administrator && { id: 'ai', label: m.nav_ai(), href: '/administration/ia', icon: 'agent' },
    me.administrator &&
      me.modules.knowledge && {
        id: 'admin_library',
        label: m.nav_admin_library(),
        href: '/administration/bibliotheque',
        icon: 'library',
      },
    me.administrator &&
      me.modules.documents && {
        id: 'admin_templates',
        label: m.nav_admin_templates(),
        href: '/administration/modeles',
        icon: 'download',
      },
    me.administrator &&
      me.demo && { id: 'demo', label: m.nav_demo(), href: '/administration/demo', icon: 'learn' },
  ];
  return all.filter((p): p is ShellPlace => Boolean(p));
}

/** The place of the frame a page belongs to (screens 2026, « Where today's menu goes »). */
function placeOf(page: Page): string {
  if (page === 'todo') return 'home';
  if (page === 'routines' || page === 'skills') return 'my_agents';
  if (page === 'dossiers') return 'assistant';
  return page;
}

/**
 * The frame's places (doctrine D-042, D-050, D-057; specs 085, 090): « Pour moi » with what waits,
 * her thread « Kete », the threads, Déléguer, Planifier — her open
 * projects and « Tiers », what she pinned under « Épinglés », the Administration when she opens it.
 * Every other place is one Ctrl K away.
 */
function sectionsOf(me: Me, current: Page): PlaceSection[] {
  const places = placesOf(me);
  const main: (ShellPlace | false)[] = [
    {
      id: 'home',
      label: m.nav_for_me(),
      href: '/',
      icon: 'inbox',
      ...(me.waiting ? { extra: { kind: 'count', value: me.waiting, hot: true } } : {}),
    },
    // Her thread with Kete (D-057): the page « Demander » became the thread « Kete ».
    { id: 'assistant', label: m.nav_kete(), href: '/assistant', icon: 'spark' },
    // The threads of her objects, her groups, her direct threads (spec 089).
    { id: 'threads', label: m.nav_threads(), href: '/fils', icon: 'chat' },
    me.modules.agents && {
      id: 'my_agents',
      label: m.nav_delegate(),
      href: '/mes-agents',
      icon: 'bot',
      ...(me.working ? { extra: { kind: 'working' } } : {}),
    },
    // Planifier (doctrine D-050; spec 079): the time of the whole organization.
    {
      id: 'plan',
      label: m.nav_plan(),
      href: '/planifier',
      icon: 'cal',
      ...(me.clashes
        ? {
            extra: {
              kind: 'word',
              value:
                me.clashes === 1
                  ? m.nav_clash_one()
                  : m.nav_clash_many({ count: String(me.clashes) }),
              hot: true,
            },
          }
        : {}),
    },
  ];
  // Her open projects, then who the organization works with (doctrine D-047).
  const projects: (ShellPlace | false)[] = [
    ...me.projects.map((project): ShellPlace => ({
      id: `project-${project.projectId}`,
      label: project.name,
      href: `/projets/${project.projectId}`,
      dot: true,
    })),
    { id: 'projects', label: m.nav_all_projects(), href: '/projets', icon: 'folder' },
    places.some((p) => p.page === 'parties') && {
      id: 'parties',
      label: m.nav_parties(),
      href: '/tiers',
      icon: 'people',
    },
  ];
  // What she pinned (spec 049), after her board.
  const pinned: ShellPlace[] = [
    ...(me.modules.dashboards
      ? [{ id: 'dashboards', label: m.nav_my_board(), href: '/tableaux-de-bord', icon: 'board' }]
      : []),
    ...me.sidebar.sections.flatMap((section, index) =>
      section.items.flatMap((shortcut, at): ShellPlace[] => {
        const to = resolveShortcut(me, places, shortcut);
        return to
          ? [{ id: `pin-${index}-${at}`, label: shortcut.label, href: to.href, icon: to.icon }]
          : [];
      }),
    ),
  ];
  const sections: PlaceSection[] = [
    { places: main.filter((p): p is ShellPlace => Boolean(p)) },
    { label: m.nav_projects(), places: projects.filter((p): p is ShellPlace => Boolean(p)) },
    ...(pinned.length ? [{ label: m.sidebar_pinned(), places: pinned }] : []),
  ];
  if (administers(me) && adminPages.includes(current)) {
    sections.push({ label: m.nav_administration(), places: adminPlaces(me) });
  }
  return sections;
}

/** The bottom of the places: her organization's apps, folded; all the apps; the Administration. */
function footOf(me: Me) {
  return {
    ...(me.apps.length
      ? {
          apps: {
            label: m.shell_apps(),
            items: me.apps.map((app) => ({
              id: `app-${app.resourceId}`,
              label: app.name,
              href: app.address,
            })),
          },
        }
      : {}),
    places: [
      { id: 'apps', label: m.shell_all_apps(), href: '/apps', icon: 'grid' },
      ...(administers(me)
        ? [{ id: 'admin', label: m.nav_administration(), href: '/administration', icon: 'shield' }]
        : []),
    ],
  };
}

/** The shell's words, from the app's catalogs. */
const shellWords = (): ShellWords => ({
  nav: m.nav_label(),
  showNav: m.nav_show(),
  hideNav: m.nav_hide(),
  search: m.palette_placeholder(),
  palette: m.palette_label(),
  palettePlaceholder: m.palette_placeholder(),
  paletteEmpty: m.palette_empty(),
  palettePlaces: m.palette_places(),
  paletteFound: m.palette_results(),
  paletteAsk: m.palette_ask(),
  paletteAskItem: (question) => m.palette_ask_item({ question }),
  ask: m.nav_ask(),
  files: m.shell_files(),
  note: m.nav_note(),
  bell: m.nav_notifications(),
  tabs: m.nav_tabs(),
  menu: m.shell_menu(),
  noteTitle: m.nav_note(),
  noteField: m.notebook_write(),
  noteHint: m.notebook_placeholder(),
  noteSave: m.notebook_keep(),
  close: m.common_close(),
  theme: m.theme_label(),
  themes: { dark: m.theme_dark(), light: m.theme_light(), auto: m.theme_auto() },
  signOut: m.nav_sign_out(),
  profile: m.shell_profile(),
  sync: {
    ok: m.shell_sync_ok(),
    offline: (pending) => m.shell_sync_offline({ count: String(pending) }),
    sending: m.shell_sync_sending(),
  },
});

const resultIcon: Record<SearchResult['kind'], IconName> = {
  conversation: 'sparkle',
  action: 'check',
  decision: 'flag',
  person: 'people',
  app: 'apps',
  document: 'file',
};

/**
 * What Ctrl K finds beyond the sidebar (spec 046): every place her modules open, her team's apps,
 * then what Kete holds for her, under her rights.
 */
function finder(me: Me) {
  return async (query: string): Promise<CommandItem[]> => {
    const q = query.trim().toLowerCase();
    const places: CommandItem[] = [
      ...placesOf(me).map((p) => ({
        id: `place-${p.page}`,
        label: p.label,
        icon: p.icon,
        href: p.href,
      })),
      ...me.apps.map((a) => ({
        id: `app-${a.resourceId}`,
        label: a.name,
        icon: 'apps' as const,
        href: a.address,
      })),
    ].filter((item) => item.label.toLowerCase().includes(q));
    const { results } = await searchEverywhere({ data: { q: query } });
    return [
      ...places,
      ...results.map((r, index) => ({
        id: `result-${index}`,
        label: r.title,
        ...(r.detail ? { hint: r.detail } : {}),
        icon: resultIcon[r.kind],
        // Found by the API: kept whatever words matched.
        keywords: [query],
        href: r.href,
      })),
    ];
  };
}

/** « Noter » from anywhere (spec 055): kept in her notebook; a reminder it filed, with its undo. */
async function keepNote(text: string): Promise<ReactNode> {
  const answer = await writeNote({ data: { text } }).catch(() => null);
  if (!answer?.ok || !answer.note) {
    return (
      <p className="text-body-sm text-state-error-fg">
        {answer ? refusal(answer.error) : m.error_generic()}
      </p>
    );
  }
  return <NoteKept note={answer.note} />;
}

/** Whether the screens reach the center: « À jour » beside the search, or offline. */
function useReach(): SyncState {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const seen = () => setOnline(navigator.onLine);
    seen();
    window.addEventListener('online', seen);
    window.addEventListener('offline', seen);
    return () => {
      window.removeEventListener('online', seen);
      window.removeEventListener('offline', seen);
    };
  }, []);
  return online ? { state: 'ok' } : { state: 'offline', pending: 0 };
}

/** The screens that take the frame's wide measure: a week, a board. */
const wideScreens: readonly Page[] = ['plan', 'dashboards'];

/** The frame of every signed-in screen: the validated canvas (doctrine D-042; spec 085). */
export function AppShell({
  me,
  current,
  bleed = false,
  children,
}: {
  me: Me;
  current: Page;
  /** The screen fills the frame itself: the page « Demander », its threads and its canvas. */
  bleed?: boolean;
  children: ReactNode;
}) {
  // Kete Intelligence beside the page (spec 085): what the page shows, a question from Ctrl K.
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState<'ask' | 'files'>('ask');
  const sync = useReach();
  const [wide, setWide] = useState(false);
  const [question, setQuestion] = useState<{ text: string; at: number } | null>(null);
  const shown = useShownPage();
  const sections = sectionsOf(me, current);
  // What she asks from: the page, when it said what it shows; else the place she stands in.
  const here = sections.flatMap((section) => section.places).find((p) => p.id === placeOf(current));
  const page = shown ?? (here ? { kind: 'place', title: here.label, href: here.href } : null);
  const ask = useCallback(
    (text?: string) => {
      // On the page « Demander », the question goes to its thread.
      if (current === 'assistant') {
        window.location.href = text ? `/assistant?q=${encodeURIComponent(text)}` : '/assistant';
        return;
      }
      if (text) setQuestion({ text, at: Date.now() });
      // The button closes the drawer only when it already shows « Demander ».
      setPanel((open) => Boolean(text) || !(open && tab === 'ask'));
      setTab('ask');
    },
    [current, tab],
  );
  useAskBeside(ask);
  const find = useCallback((query: string) => finder(me)(query), [me]);
  const firstName = me.name.split(' ')[0] ?? me.name;
  return (
    <AppFrame
      brand={{ name: m.brand_kete() }}
      org={{ name: me.organization }}
      sections={sections}
      foot={footOf(me)}
      current={placeOf(current)}
      person={{ name: me.name, detail: me.email }}
      words={shellWords()}
      find={find}
      onAsk={ask}
      askHref="/assistant"
      beside={{
        open: panel && current !== 'assistant',
        wide,
        label: m.intelligence_name(),
        content: (
          <CenterIntelligence
            page={page}
            question={question}
            name={firstName}
            apps={me.apps}
            tab={tab}
            onTab={setTab}
            head={{
              onHistory: () => {
                window.location.href = '/assistant';
              },
              wide,
              onWide: () => setWide((value) => !value),
              onClose: () => setPanel(false),
            }}
          />
        ),
      }}
      {...(me.viewedBy ? {} : { onNote: keepNote })}
      onFiles={() => {
        setPanel((open) => !(open && tab === 'files'));
        setTab('files');
      }}
      sync={sync}
      bell={{ href: '/notifications', count: me.unread }}
      tabs={['home', 'threads', 'plan']}
      signOutHref="/auth/sortie"
    >
      {me.viewedBy && <ViewingBanner me={me} />}
      {bleed ? children : <FramePage wide={wideScreens.includes(current)}>{children}</FramePage>}
    </AppFrame>
  );
}
