import { createRouter } from '@tanstack/react-router';
import { PageError } from './lib/page-error';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultErrorComponent: PageError,
  });
}
