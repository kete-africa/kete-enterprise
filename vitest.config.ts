import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*'],
    // With KETE_TEST_POSTGRES=container, one Postgres for the whole run (@kete/testing).
    globalSetup: ['@kete/testing/global-setup'],
  },
});
