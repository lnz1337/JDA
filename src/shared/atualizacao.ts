/**
 * Versão nova do app: quando recarregar a tela (CLAUDE.md §12).
 *
 * O shell do app fica no cache do service worker, e o app instalado no iPhone
 * volta da memória sem recarregar — pode passar dias rodando o JavaScript de
 * antes. Isso deixou de ser só incômodo em 05/11: a entrada sem código tirou a
 * rota do código de login, e quem estava deslogado com a versão antiga via uma
 * tela que não funciona mais.
 *
 * A regra vale para os dois lados: o service worker novo, que recarrega as abas
 * abertas ao assumir (inclusive as da versão antiga, que não sabem se
 * recarregar), e a página, que recarrega no `controllerchange`. Nos dois, **a
 * oração não é interrompida**: o áudio só toca na lição, e a lição só recarrega
 * parada e fora da vista.
 */

/** Lição é onde o áudio toca; o resto do app recarrega sem perder nada. */
export function abaPodeRecarregar(caminho: string): boolean {
  return !caminho.startsWith('/licao/');
}

export interface EstadoDaTela {
  caminho: string;
  audioTocando: boolean;
  visivel: boolean;
}

/**
 * Áudio tocando nunca recarrega — nem com a tela apagada, que é justamente
 * quando se reza ouvindo. Lição parada e à vista também espera: a pessoa pode
 * estar lendo a reflexão.
 */
export function podeRecarregarAgora(estado: EstadoDaTela): boolean {
  if (estado.audioTocando) return false;
  if (abaPodeRecarregar(estado.caminho)) return true;
  return !estado.visivel;
}

/**
 * De quanto em quanto tempo, no máximo, a página pergunta por versão nova ao
 * voltar para a frente. O navegador só procura sozinho ao navegar, e o app
 * instalado quase nunca navega: volta da memória.
 */
// A procura é um pedido pequeno do `sw.js`; 5 min basta para não repetir a
// cada troca de app e deixa o teste no celular sem meia hora de espera.
export const PROCURAR_VERSAO_MS = 5 * 60 * 1000;

export function deveProcurarVersao(ultimaMs: number | null, agoraMs: number): boolean {
  return ultimaMs === null || agoraMs - ultimaMs >= PROCURAR_VERSAO_MS;
}
