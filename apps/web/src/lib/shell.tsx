import { NavItem, NavSection, Shell } from '@kete/design';
import type { ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';

/** The frame of every signed-in screen, in the workspace design (doctrine D-035, D-036). */
export function AppShell({
  current,
  children,
}: {
  current: 'home' | 'structure' | 'rights' | 'registry';
  children: ReactNode;
}) {
  return (
    <Shell
      brand={m.app_name()}
      navLabel={m.nav_label()}
      showNavLabel={m.nav_show()}
      hideNavLabel={m.nav_hide()}
      nav={
        <NavSection>
          <NavItem href="/" icon="apps" current={current === 'home'}>
            {m.nav_home()}
          </NavItem>
          <NavItem href="/structure" icon="library" current={current === 'structure'}>
            {m.nav_structure()}
          </NavItem>
          <NavItem href="/droits" icon="check" current={current === 'rights'}>
            {m.nav_rights()}
          </NavItem>
          <NavItem href="/registre" icon="library" current={current === 'registry'}>
            {m.nav_registry()}
          </NavItem>
        </NavSection>
      }
      toolbar={
        <a href="/auth/sortie" className="text-body-sm text-link underline">
          {m.nav_sign_out()}
        </a>
      }
    >
      {children}
    </Shell>
  );
}
