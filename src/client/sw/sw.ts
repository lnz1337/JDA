/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { abaPodeRecarregar } from '../../shared/atualizacao';

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

/*
 * Versão nova assume na hora (src/shared/atualizacao.ts).
 *
 * Antes de 05/11 o service worker novo esperava todas as abas fecharem, e o app
 * instalado no iPhone quase nunca fecha de verdade: volta da memória com o
 * JavaScript de antes. Agora ele ativa assim que instala, toma conta das abas
 * abertas e recarrega as que estão fora da lição. Quem recarrega é ele, e não
 * só a página no `controllerchange`, porque a página da versão antiga não sabe
 * se recarregar — e é ela que mostrava a tela do código que não existe mais.
 *
 * Só quando substitui uma versão anterior: na primeira instalação a página já é
 * a nova, e recarregar atrapalharia quem está digitando o celular.
 */
let substituiVersaoAnterior = false;

self.addEventListener('install', () => {
  substituiVersaoAnterior = self.registration.active !== null;
  void self.skipWaiting();
});

/*
 * O recarregamento é disparado e **não esperado** dentro do `waitUntil`. A
 * navegação passa pelo `fetch` deste service worker, e o navegador segura o
 * `fetch` até a ativação terminar; esperar a navegação dentro da ativação é um
 * travamento mútuo — a aba fica parada, em branco (visto no staging em 05/11).
 */
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      if (!substituiVersaoAnterior) return;

      const abas = await self.clients.matchAll({ type: 'window' });
      for (const aba of abas) {
        if (!abaPodeRecarregar(new URL(aba.url).pathname)) continue;
        // Navegador sem `navigate` ou aba já saindo: a próxima abertura pega a
        // versão nova do mesmo jeito.
        aba.navigate(aba.url).catch(() => undefined);
      }
    })(),
  );
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
