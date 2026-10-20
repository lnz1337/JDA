/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

/**
 * Shadow do `self` global com o tipo de service worker. `self.__WB_MANIFEST`
 * precisa aparecer literalmente: o vite-plugin-pwa injeta o precache manifest
 * procurando essa expressão no bundle.
 */
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// Push e cache de mídia entram nas fases 8 e 12 (CLAUDE.md §16).
