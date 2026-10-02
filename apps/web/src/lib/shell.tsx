import { Button, NavItem, NavSection, Shell } from '@kete/design';
import type { ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { administers, opens, viewAs, type Me } from './me';

/** Where a screen sits: the person's space, or the Administration (spec 010). */
export type Page =
  | 'home'
  | 'todo'
  | 'assistant'
  | 'resources'
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
  | 'demo';

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

/** The space: « Me », then the business tools her modules and rights open. */
function SpaceNav({ me, current }: { me: Me; current: Page }) {
  return (
    <>
      <NavSection label={m.nav_me()}>
        <NavItem href="/" icon="apps" current={current === 'home'}>
          {m.nav_home()}
        </NavItem>
        <NavItem href="/a-faire" icon="check" current={current === 'todo'}>
          {m.nav_todo()}
        </NavItem>
        <NavItem href="/assistant" icon="agent" current={current === 'assistant'}>
          {m.nav_assistant()}
        </NavItem>
        <NavItem href="/ressources" icon="library" current={current === 'resources'}>
          {m.nav_resources()}
        </NavItem>
      </NavSection>
      <NavSection label={m.nav_tools()}>
        {opens(me, 'surveys', ['surveys:manage']) && (
          <NavItem href="/enquetes" icon="teach" current={current === 'surveys'}>
            {m.nav_surveys()}
          </NavItem>
        )}
        {opens(me, 'performance', [
          'performance:manage',
          'performance:measure',
          'performance:validate',
          'performance:read',
        ]) && (
          <NavItem href="/performance" icon="learn" current={current === 'performance'}>
            {m.nav_performance()}
          </NavItem>
        )}
        {me.modules.performance && me.personId && (
          <NavItem href="/mon-equipe" icon="agent" current={current === 'team'}>
            {m.nav_team()}
          </NavItem>
        )}
        {opens(me, 'meetings', ['meetings:manage', 'meetings:publish']) && (
          <NavItem href="/instances" icon="library" current={current === 'meetings'}>
            {m.nav_meetings()}
          </NavItem>
        )}
        {opens(me, 'compliance', ['compliance:read', 'compliance:manage']) && (
          <NavItem href="/conformite" icon="check" current={current === 'compliance'}>
            {m.nav_compliance()}
          </NavItem>
        )}
      </NavSection>
    </>
  );
}

/** The Administration: the frame only — never a survey or a grid (spec 010). */
function AdminNav({ me, current }: { me: Me; current: Page }) {
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

/** The frame of every signed-in screen, in the workspace design (doctrine D-035, D-036). */
export function AppShell({
  me,
  current,
  children,
}: {
  me: Me;
  current: Page;
  children: ReactNode;
}) {
  const inAdmin = adminPages.includes(current);
  return (
    <Shell
      brand={m.app_name()}
      navLabel={m.nav_label()}
      showNavLabel={m.nav_show()}
      hideNavLabel={m.nav_hide()}
      nav={
        inAdmin ? <AdminNav me={me} current={current} /> : <SpaceNav me={me} current={current} />
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-4 text-body-sm">
          {inAdmin ? (
            <a href="/" className="text-link underline">
              {m.nav_to_space()}
            </a>
          ) : (
            administers(me) && (
              <a href="/administration" className="text-link underline">
                {m.nav_to_admin()}
              </a>
            )
          )}
          <a href="/auth/sortie" className="text-link underline">
            {m.nav_sign_out()}
          </a>
        </div>
      }
    >
      {me.viewedBy && <ViewingBanner me={me} />}
      {children}
    </Shell>
  );
}
