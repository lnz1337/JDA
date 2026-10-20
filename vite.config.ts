import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_SHORT_NAME,
  BACKGROUND_COLOR,
  THEME_COLOR,
} from './src/shared/constants';

/**
 * O vite-plugin-pwa só deve rodar no build do client: sem isso ele também
 * emite manifest/registerSW dentro da saída do Worker.
 */
function clientOnly(plugins: Plugin[]): Plugin[] {
  return plugins.map((plugin) => ({
    ...plugin,
    applyToEnvironment: (environment: { name: string }) => environment.name === 'client',
  }));
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    ...clientOnly(
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/client/sw',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        injectManifest: {
          // Shell do app no precache. Áudio nunca entra aqui (CLAUDE.md §12).
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          globIgnores: ['**/audio/**'],
        },
        manifest: {
          id: '/',
          name: APP_NAME,
          short_name: APP_SHORT_NAME,
          description: APP_DESCRIPTION,
          lang: 'pt-BR',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: THEME_COLOR,
          background_color: BACKGROUND_COLOR,
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        devOptions: { enabled: false },
      }) as Plugin[],
    ),
  ],
});
