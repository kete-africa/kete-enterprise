import { Button, Icon, IconButton, NavItem, NavSection, type IconName } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import type { Me } from './me';
import type { Page, Place } from './shell';
import {
  arrangeSidebar,
  pinShortcut,
  resetSidebar,
  unpinShortcut,
  type Shortcut,
  type SidebarLayout,
} from './sidebar';

// The sidebar the person arranges (spec 049): the places Kete proposes, which she may hide but for
// « Aujourd'hui » and « À faire »; her shortcuts, in sections she names and orders.

/** The places the sidebar proposes, in this order; the rest is under « Tout ». */
export const proposedPlaces: Page[] = [
  'home',
  'todo',
  'assistant',
  'my_agents',
  'routines',
  'dossiers',
  'dashboards',
  'team',
  'resources',
];
const fixed: Page[] = ['home', 'todo'];

const kindIcon: Record<Shortcut['kind'], IconName> = {
  place: 'layers',
  dashboard: 'chart',
  dossier: 'folder',
  agent: 'agent',
  conversation: 'sparkle',
  app: 'apps',
  link: 'arrow',
};

/** Where a shortcut leads, and its icon; none when it no longer opens anything for her. */
export function resolveShortcut(
  me: Me,
  places: Place[],
  s: Shortcut,
): { href: string; icon: IconName; external: boolean } | null {
  switch (s.kind) {
    case 'place': {
      const place = places.find((p) => p.page === s.ref);
      return place ? { href: place.href, icon: place.icon, external: false } : null;
    }
    case 'dashboard':
      return { href: `/tableaux-de-bord/${s.ref}`, icon: kindIcon.dashboard, external: false };
    case 'dossier':
      return { href: `/dossiers/${s.ref}`, icon: kindIcon.dossier, external: false };
    case 'agent':
      return { href: '/mes-agents', icon: kindIcon.agent, external: false };
    case 'conversation':
      return { href: `/assistant?c=${s.ref}`, icon: kindIcon.conversation, external: false };
    case 'app': {
      const app = me.apps.find((a) => a.resourceId === s.ref);
      return app ? { href: app.address, icon: kindIcon.app, external: true } : null;
    }
    case 'link':
      return { href: s.ref, icon: kindIcon.link, external: false };
  }
}

const sectionName = (name: string | null) => name ?? m.sidebar_pinned();

/** The sidebar as she arranged it, and the gesture to arrange it. */
export function SidebarNav({
  me,
  places,
  current,
  elsewhere,
}: {
  me: Me;
  places: Place[];
  current: Page;
  elsewhere: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !me.viewedBy) {
    return <SidebarEditor me={me} places={places} onDone={() => setEditing(false)} />;
  }
  const layout = me.sidebar;
  const shown = proposedPlaces
    .map((page) => places.find((p) => p.page === page))
    .filter((p): p is Place => p !== undefined && !layout.hidden.includes(p.page));
  return (
    <>
      <NavSection>
        {shown.map((p) => (
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
      {layout.sections.map((section, i) => {
        const items = section.items.flatMap((s) => {
          const to = resolveShortcut(me, places, s);
          return to ? [{ s, to }] : [];
        });
        if (items.length === 0) return null;
        return (
          <NavSection key={`${i}-${section.name ?? ''}`} label={sectionName(section.name)}>
            {items.map(({ s, to }) => (
              <NavItem
                key={`${s.kind}:${s.ref}`}
                href={to.href}
                icon={to.icon}
                {...(to.external ? { external: true } : {})}
              >
                {s.label}
              </NavItem>
            ))}
          </NavSection>
        );
      })}
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
        {!me.viewedBy && (
          <NavItem icon="tool" onClick={() => setEditing(true)}>
            {m.sidebar_arrange()}
          </NavItem>
        )}
      </NavSection>
    </>
  );
}

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/** Arranging the sidebar: hide a place, order and remove shortcuts, name and add sections. */
function SidebarEditor({ me, places, onDone }: { me: Me; places: Place[]; onDone: () => void }) {
  const router = useRouter();
  const [layout, setLayout] = useState<SidebarLayout>(() => structuredClone(me.sidebar));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const proposed = proposedPlaces
    .map((page) => places.find((p) => p.page === page))
    .filter((p): p is Place => Boolean(p));
  const pinnedRefs = new Set(
    layout.sections.flatMap((s) => s.items.map((i) => `${i.kind}:${i.ref}`)),
  );
  const candidates = places.filter(
    (p) => !proposedPlaces.includes(p.page) && !pinnedRefs.has(`place:${p.page}`),
  );
  const setSection = (i: number, change: (s: SidebarLayout['sections'][number]) => void) =>
    setLayout((l) => {
      const next = structuredClone(l);
      const section = next.sections[i];
      if (section) change(section);
      return next;
    });
  const finish = async (save: () => Promise<{ ok: boolean }>) => {
    setBusy(true);
    setFailed(false);
    const answer = await save().catch(() => ({ ok: false }));
    setBusy(false);
    if (!answer.ok) return setFailed(true);
    await router.invalidate();
    onDone();
  };
  const row = 'flex min-h-(--control-height) items-center gap-1 rounded-control';
  return (
    <section aria-label={m.sidebar_editing()} className="grid gap-4">
      <ul className="grid">
        {proposed.map((p) => {
          const hidden = layout.hidden.includes(p.page);
          const locked = fixed.includes(p.page);
          return (
            <li key={p.page} className={row}>
              <span
                className={`flex min-w-0 flex-1 items-center gap-2.5 ${hidden ? 'opacity-50' : ''}`}
              >
                <Icon name={p.icon} />
                <span className="truncate">{p.label}</span>
              </span>
              {!locked && (
                <button
                  type="button"
                  aria-pressed={!hidden}
                  onClick={() =>
                    setLayout((l) => ({
                      ...l,
                      hidden: hidden ? l.hidden.filter((h) => h !== p.page) : [...l.hidden, p.page],
                    }))
                  }
                  className="rounded-control px-2 py-1 text-body-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
                >
                  {hidden ? m.sidebar_show({ name: p.label }) : m.sidebar_hide({ name: p.label })}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {layout.sections.map((section, si) => (
        <div key={si} className="grid gap-1">
          <div className="flex items-center gap-1">
            <input
              aria-label={m.sidebar_section_name()}
              value={section.name ?? ''}
              placeholder={m.sidebar_pinned()}
              maxLength={40}
              onChange={(e) =>
                setSection(si, (s) => {
                  s.name = e.target.value.trim() ? e.target.value : null;
                })
              }
              className="h-8 min-w-0 flex-1 rounded-control border border-line-control bg-surface-control px-2 text-body-sm"
            />
            {layout.sections.length > 1 && (
              <IconButton
                label={m.sidebar_remove_section()}
                onClick={() =>
                  setLayout((l) => {
                    const next = structuredClone(l);
                    const [gone] = next.sections.splice(si, 1);
                    next.sections[0]?.items.push(...(gone?.items ?? []));
                    return next;
                  })
                }
              >
                <Icon name="close" />
              </IconButton>
            )}
          </div>
          {section.items.length === 0 ? (
            <p className="px-1 text-body-sm text-fg-muted">{m.sidebar_empty_section()}</p>
          ) : (
            <ul className="grid">
              {section.items.map((item, ii) => (
                <li key={`${item.kind}:${item.ref}`} className={row}>
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Icon name={kindIcon[item.kind]} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <IconButton
                    label={m.sidebar_up({ name: item.label })}
                    disabled={ii === 0}
                    onClick={() => setSection(si, (s) => (s.items = move(s.items, ii, ii - 1)))}
                  >
                    <Icon name="up" />
                  </IconButton>
                  <IconButton
                    label={m.sidebar_down({ name: item.label })}
                    disabled={ii === section.items.length - 1}
                    onClick={() => setSection(si, (s) => (s.items = move(s.items, ii, ii + 1)))}
                  >
                    <Icon name="down" />
                  </IconButton>
                  <IconButton
                    label={m.sidebar_remove({ name: item.label })}
                    onClick={() => setSection(si, (s) => s.items.splice(ii, 1))}
                  >
                    <Icon name="close" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="grid gap-2">
        <Button
          variant="secondary"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          <Icon name="plus" />
          {m.sidebar_add()}
        </Button>
        {adding &&
          (candidates.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{m.sidebar_add_none()}</p>
          ) : (
            <ul className="grid rounded-control border border-line">
              {candidates.map((p) => (
                <li key={p.page}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-2 py-2 text-left hover:bg-surface-hover"
                    onClick={() =>
                      setSection(layout.sections.length - 1, (s) =>
                        s.items.push({ kind: 'place', ref: p.page, label: p.label }),
                      )
                    }
                  >
                    <Icon name={p.icon} />
                    <span className="truncate">{p.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {layout.sections.length < 8 && (
          <Button
            variant="secondary"
            onClick={() =>
              setLayout((l) => ({
                ...l,
                sections: [...l.sections, { name: m.sidebar_new_section(), items: [] }],
              }))
            }
          >
            <Icon name="plus" />
            {m.sidebar_new_section()}
          </Button>
        )}
      </div>
      <p className="text-body-sm text-fg-muted">{m.sidebar_fixed()}</p>
      {failed && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {m.sidebar_failed()}
        </p>
      )}
      <div className="grid gap-2">
        <Button disabled={busy} onClick={() => void finish(() => arrangeSidebar({ data: layout }))}>
          {m.sidebar_done()}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onDone}>
          {m.sidebar_cancel()}
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void finish(() => resetSidebar())}
          className="text-body-sm text-fg-muted underline underline-offset-4 hover:text-fg"
        >
          {m.sidebar_reset()}
        </button>
      </div>
    </section>
  );
}

/** « Épingler dans la barre » where a thing lives: pinned once, removed the same way. */
export function PinToSidebar({ me, shortcut }: { me: Me; shortcut: Shortcut }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (me.viewedBy) return null;
  const pinned = me.sidebar.sections.some((s) =>
    s.items.some((i) => i.kind === shortcut.kind && i.ref === shortcut.ref),
  );
  return (
    <Button
      variant="secondary"
      disabled={busy}
      aria-pressed={pinned}
      onClick={() => {
        setBusy(true);
        const gesture = pinned
          ? unpinShortcut({ data: { kind: shortcut.kind, ref: shortcut.ref } })
          : pinShortcut({ data: shortcut });
        void gesture.then(() => router.invalidate()).finally(() => setBusy(false));
      }}
    >
      {pinned ? m.unpin_from_sidebar() : m.pin_to_sidebar()}
    </Button>
  );
}
