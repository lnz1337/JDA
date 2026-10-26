/**
 * Descrever a falha do lembrete em vez de esconder (CLAUDE.md §11).
 *
 * O `catch` do `ligarLembrete` engolia tudo: a tela dizia "não consegui ligar o
 * lembrete agora" e não havia como saber qual passo arrebentou — permissão,
 * service worker, chave, assinatura ou gravação. Sem Mac para inspecionar o
 * Safari do iPhone, o erro precisa chegar por aqui.
 *
 * O que carrega a informação é o **`name`** da exceção: no WebKit é ele que
 * separa `NotAllowedError` (o gesto do toque se perdeu) de `AbortError` (o
 * serviço de push recusou) e de `InvalidStateError` (já existe assinatura com
 * outra chave).
 */
import { ErroApi } from './api';

/** Em que ponto da corrente o lembrete parou. */
export type EtapaPush = 'permissao' | 'service_worker' | 'chave' | 'assinar' | 'gravar';

export interface FalhaPush {
  etapa: EtapaPush;
  /** `nome: mensagem`. Nunca o endpoint. */
  erro: string;
  /** Só quando a falha veio de uma resposta do Worker. */
  status?: number;
}

/** Mensagem longa não cabe em `events` nem na tela, e não acrescenta nada. */
const LIMITE = 200;

/**
 * Tira qualquer URL do texto.
 *
 * O endpoint da assinatura é **credencial de entrega**, não dado de relatório
 * (§11), e mensagem de erro de rede às vezes traz a URL inteira. O corte é aqui,
 * antes de o evento subir, e não na hora de montar a mensagem: é o único lugar
 * por onde todo texto de erro passa.
 */
export function semUrl(texto: string): string {
  return texto.replace(/\b(?:https?|wss?):\/\/\S*/gi, '[url]');
}

export function descreverErro(e: unknown): { erro: string; status?: number } {
  if (e instanceof ErroApi) {
    // `ErroApi` não define `name`, então ele sairia como "Error"; o que
    // interessa é o código que o Worker devolveu.
    return { erro: `ErroApi: ${semUrl(e.codigo).slice(0, LIMITE)}`, status: e.status };
  }

  /*
   * Sem `instanceof Error`: em WebKit antigo `DOMException` não herda de
   * `Error`, e é justamente a DOMException que diz por que o `subscribe`
   * falhou. Ler `name` e `message` direto funciona nos dois casos.
   */
  const erro = e as { name?: unknown; message?: unknown } | null | undefined;
  const nome = typeof erro?.name === 'string' && erro.name ? erro.name : 'Desconhecido';
  const mensagem = typeof erro?.message === 'string' ? erro.message : String(e);

  return { erro: `${nome}: ${semUrl(mensagem).slice(0, LIMITE)}` };
}
