import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Local development reads the repository's .env; deployed servers get real environment variables.
const localEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

export default defineConfig({
  plugins: [
    // Language: the person's choice (cookie), then the browser, then French.
    paraglideVitePlugin({
      project: fileURLToPath(new URL('./project.inlang', import.meta.url)),
      outdir: fileURLToPath(new URL('./src/paraglide', import.meta.url)),
      outputStructure: 'message-modules',
      cookieName: 'kete_locale',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
    }),
    tailwindcss(),
    // Files are named in English; addresses are French, declared once in src/routes.ts.
    tanstackStart({ router: { virtualRouteConfig: './src/routes.ts' } }),
    react(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
