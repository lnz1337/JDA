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
 * `robots.txt` e `_headers` dependem do ambiente, e o ambiente é escolhido no
 * build (CLAUDE.md §2) — então eles são **gerados**, não versionados.
 *
 * Staging mora num subdomínio do domínio de verdade. Se o Google indexar aquilo,
 * o resultado é uma cópia do app aparecendo na busca, o que é ruim para o cliente
 * (entra no app errado) e para a reputação do domínio. Por isso staging sai com
 * `Disallow: /` e `X-Robots-Tag: noindex`.
 *
 * O `_headers` vale só para asset estático; resposta gerada pelo Worker não passa
 * por ele (é o `index.html` que interessa aqui). As páginas que o Worker serve
 * recebem o cabeçalho no próprio Worker (`lib/pagina.ts` / `index.ts`).
 */
function robots(producao: boolean): Plugin {
  return {
    name: 'jda-robots',
    applyToEnvironment: (environment: { name: string }) => environment.name === 'client',
    generateBundle() {
      const txt = producao
        ? [
            'User-agent: *',
            'Allow: /',
            '',
            '# Telas de acesso não têm o que indexar e não devem aparecer na busca.',
            'Disallow: /entrar',
            'Disallow: /acesso',
            'Disallow: /parar',
            '',
          ].join('\n')
        : ['# Ambiente de teste: não indexar nada.', 'User-agent: *', 'Disallow: /', ''].join('\n');

      const headers = producao
        ? ['/entrar*', '  X-Robots-Tag: noindex', ''].join('\n')
        : ['/*', '  X-Robots-Tag: noindex, nofollow', ''].join('\n');

      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: txt });
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers });
    },
  };
}

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
  /*
   * Em staging a tela de falha do lembrete mostra a etapa e o erro em letra
   * pequena. Não há Mac para abrir o inspetor do Safari do iPhone, e sem isso a
   * única informação sobre a falha era "não consegui". Em produção não aparece:
   * quem está rezando não tem o que fazer com um `AbortError`.
   */
  define: {
    __DIAGNOSTICO__: JSON.stringify(process.env.CLOUDFLARE_ENV !== 'production'),
  },
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    robots(process.env.CLOUDFLARE_ENV === 'production'),
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
