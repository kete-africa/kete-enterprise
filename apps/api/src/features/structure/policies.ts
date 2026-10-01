import type { KeteIdentity } from '@kete/auth';

/**
 * Who may change the structure. Until scoped roles (spec 003), the organization's owners and admins
 * at the Compte Kete; every member reads it.
 */
export function canChangeStructure(identity: Pick<KeteIdentity, 'role'>): boolean {
  return identity.role === 'owner' || identity.role === 'admin';
}
