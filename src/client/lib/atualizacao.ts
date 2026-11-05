/**
 * A página do lado da versão nova (a regra está em src/shared/atualizacao.ts).
 *
 * - Quando o service worker novo assume (`controllerchange`), recarrega — na
 *   hora fora da lição; na lição, só com o áudio parado e a tela fora da vista.
 * - Ao voltar para a frente, pergunta por versão nova. O navegador só procura
 *   sozinho ao navegar, e o app instalado volta da memória sem navegar.
 *
 * O service worker também recarrega as abas ao assumir: é o que alcança a
 * página da versão antiga, que não tem este código. Nas versões daqui em diante
 * os dois pedem o mesmo recarregamento, e um deles basta.
 */
import { deveProcurarVersao, podeRecarregarAgora } from '../../shared/atualizacao';
import { EVENTO } from './rota';

export function cuidarDaAtualizacao(): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  // Sem service worker na abertura, o primeiro `controllerchange` é a
  // instalação, não uma versão nova: a página já é a nova.
  let tinhaVersao = sw.controller !== null;
  let pendente = false;
  let recarregando = false;

  const audioTocando = () =>
    Array.from(document.querySelectorAll('audio')).some((a) => !a.paused && !a.ended);

  const tentar = () => {
    if (!pendente || recarregando) return;
    const estado = {
      caminho: location.pathname,
      audioTocando: audioTocando(),
      visivel: document.visibilityState === 'visible',
    };
    if (!podeRecarregarAgora(estado)) return;
    recarregando = true;
    location.reload();
  };

  sw.addEventListener('controllerchange', () => {
    if (!tinhaVersao) {
      tinhaVersao = true;
      return;
    }
    pendente = true;
    tentar();
  });

  // O que muda a resposta de `podeRecarregarAgora`: sair da lição, parar o
  // áudio, a tela sair da vista. `pause` e `ended` não sobem pela árvore, por
  // isso a captura.
  addEventListener(EVENTO, tentar);
  addEventListener('popstate', tentar);
  document.addEventListener('pause', tentar, true);
  document.addEventListener('ended', tentar, true);

  let ultimaProcura: number | null = Date.now();
  document.addEventListener('visibilitychange', () => {
    tentar();
    if (document.visibilityState !== 'visible') return;
    const agora = Date.now();
    if (!deveProcurarVersao(ultimaProcura, agora)) return;
    ultimaProcura = agora;
    sw.getRegistration()
      .then((registro) => registro?.update())
      .catch(() => {
        // Sem internet agora: procura na próxima volta.
      });
  });
}
