import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, SignInRequired } from '@/platform/api';

export interface Me {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member' | null;
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
