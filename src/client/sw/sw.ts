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

interface Lembrete {
  titulo: string;
  corpo: string;
  url: string;
  tag?: string;
}

/**
 * Lembrete de oração (CLAUDE.md §11).
 *
 * O payload vem cifrado e é o Worker quem monta — aqui só se desenha. Se ele
 * vier ilegível, ainda assim aparece uma notificação: o navegador **exige** que
 * todo push mostre algo (`userVisibleOnly`), e sumir calado custaria a permissão
 * do aparelho.
 */
self.addEventListener('push', (event: PushEvent) => {
  let dados: Lembrete = {
    titulo: 'Jornada com Meu Anjo',
    corpo: 'A oração do dia está esperando por você.',
    url: '/',
  };

  try {
    const recebido = event.data?.json() as Partial<Lembrete> | null;
    if (recebido?.titulo && recebido.corpo) dados = { ...dados, ...recebido } as Lembrete;
  } catch {
    // Payload que não dá para ler cai no texto padrão acima.
  }

  event.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Mesma tag: o lembrete de hoje substitui o de ontem na gaveta.
      tag: dados.tag ?? 'oracao-do-dia',
      data: { url: dados.url },
    }),
  );
});

/**
 * Toque na notificação. Se o app já estiver aberto, foca a janela que existe em
 * vez de abrir outra — duas janelas do mesmo app confundem, e no Android a de
 * trás fica perdida na lista de recentes.
 */
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const destino = (event.notification.data as { url?: string } | null)?.url ?? '/';

  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const janela of janelas) {
        if (new URL(janela.url).origin !== self.location.origin) continue;
        await janela.focus();
        // `navigate` falha em alguns navegadores: o foco já é o essencial.
        await janela.navigate(destino).catch(() => undefined);
        return;
      }

      await self.clients.openWindow(destino);
    })(),
  );
});

// Cache de mídia entra na fase 12 (CLAUDE.md §16).
