import { createServerFn } from '@tanstack/react-start';
import { deleteCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { callApi, SignInRequired, VIEW_AS_COOKIE } from '@/platform/api';

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
  | 'datasets';

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
}

/** The signed-in person and her organization, as the API sees them; null without a session. */
export const fetchMe = createServerFn({ method: 'GET' }).handler(async (): Promise<Me | null> => {
  try {
    return await callApi<Me>(getRequest(), '/v1/me');
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
