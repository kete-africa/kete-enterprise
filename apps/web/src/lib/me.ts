import { createServerFn } from '@tanstack/react-start';
import { deleteCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { env } from '@/platform/env';
import { callApi, SignInRequired, VIEW_AS_COOKIE } from '@/platform/api';
import type { SidebarLayout } from './sidebar';

export type ModuleKey =
  | 'surveys'
  | 'performance'
  | 'meetings'
  | 'compliance'
  | 'agents'
  | 'knowledge'
  | 'dossiers'
  | 'documents'
  | 'skills'
  | 'datasets'
  | 'forms'
  | 'dashboards';

export interface Me {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member' | null;
  /** Her person in the organization, found by e-mail on her first sign-in (spec 010). */
  personId: string | null;
  administrator: boolean;
  /** The permissions she holds somewhere. */
  permissions: string[];
  modules: Record<ModuleKey, boolean>;
  demo: boolean;
  /** In a demo organization: the administrator viewing the space as this person. */
  viewedBy: string | null;
  /** The team's apps she may open, from the registry (spec 016). */
  apps: { resourceId: string; name: string; address: string }[];
  /** How many things wait for her: the count beside « À faire » (spec 046). */
  waiting: number;
  /** Her unread notifications. */
  unread: number;
  /** The sidebar she arranged (spec 049). */
  sidebar: SidebarLayout;
  /** Her organization's name, in the top bar (spec 085). */
  organization: string;
  /** Her open projects, in the places (spec 085). */
  projects: { projectId: string; name: string }[];
  /** Whether an agent works for her now: its spinner beside « Déléguer ». */
  working: boolean;
  /** The clashes of her week: « 1 conflit » beside « Planifier ». */
  clashes: number;
  /** Nothing here yet in this organization: the screens say so (spec 098, FR-001). */
  empty: boolean;
  /** Where she changes organization, coming back here signed in to it. */
  switchHref: string;
}

/** The signed-in person and her organization, as the API sees them; null without a session. */
export const fetchMe = createServerFn({ method: 'GET' }).handler(async (): Promise<Me | null> => {
  try {
    const me = await callApi<Omit<Me, 'switchHref'>>(getRequest(), '/v1/me');
    const back = `${env.publicUrl}/auth/connexion`;
    return {
      ...me,
      empty: me.empty === true,
      switchHref: `${env.accountUrl}/espace/changer?retour=${encodeURIComponent(back)}`,
    };
  } catch (error) {
    if (error instanceof SignInRequired) return null;
    throw error;
  }
});

/** Who may open the Administration: whoever holds a part of the frame. */
export function administers(me: Me): boolean {
  const frame = [
    'structure:write',
    'rights:manage',
    'decisions:manage',
    'registry:review',
    'agents:manage',
  ];
  return me.administrator || frame.some((p) => me.permissions.includes(p));
}

/** Whether a business tool shows: its module on, and one of its permissions held. */
export function opens(me: Me, module: ModuleKey, permissions: string[]): boolean {
  return (
    me.modules[module] && (me.administrator || permissions.some((p) => me.permissions.includes(p)))
  );
}

/** Views the space as a person of a demo organization (the API checks it), or comes back. */
export const viewAs = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const personId = (input as { personId?: unknown } | null)?.personId;
    if (
      personId !== null &&
      (typeof personId !== 'string' || !/^prs_[0-9a-f-]{8,64}$/.test(personId))
    ) {
      throw new Error('Unknown person.');
    }
    return { personId };
  })
  .handler(({ data }) => {
    const options = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: true };
    if (data.personId) setCookie(VIEW_AS_COOKIE, data.personId, options);
    else deleteCookie(VIEW_AS_COOKIE, options);
    return { ok: true };
  });
