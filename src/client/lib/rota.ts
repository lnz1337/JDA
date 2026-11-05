/**
 * Roteador mínimo, por `pathname`.
 *
 * Não é biblioteca de propósito: o app tem poucas telas e precisa carregar rápido
 * num celular antigo. Se as abas da fase 6 em diante pedirem mais do que isto
 * (rota aninhada, transição, carregamento por rota), troca-se por uma de
 * verdade; o que o resto do app usa é `useRota` e `irPara`, então a troca fica
 * contida aqui.
 */
import { useEffect, useState } from 'react';
import { passoDaBusca } from '../../shared/licao';

export type Rota =
  | { nome: 'inicio' }
  | { nome: 'entrar' }
  | { nome: 'programa'; id: string }
  /** `passo` de 1 a 3 (`?passo=2`): a lição em passos. Sem ele, o 1. */
  | { nome: 'licao'; id: string; passo: number }
  | { nome: 'instalar' }
  | { nome: 'lembrete' }
  | { nome: 'loja' }
  | { nome: 'produto'; id: string };

/** Disparado a cada `irPara`; `lib/atualizacao.ts` escuta para recarregar ao sair da lição. */
export const EVENTO = 'jda:rota';

export function rotaDe(caminho: string, busca: string): Rota {
  const parametros = new URLSearchParams(busca);

  // Link nosso (e-mail preenchido, ou link de acesso que não serviu mais) vai
  // direto para o login: quem veio de lá já sabe onde está.
  if (caminho === '/entrar' || parametros.has('e') || parametros.has('motivo')) {
    return { nome: 'entrar' };
  }

  if (caminho === '/instalar') return { nome: 'instalar' };
  if (caminho === '/lembrete') return { nome: 'lembrete' };
  if (caminho === '/loja') return { nome: 'loja' };

  const programa = /^\/programa\/([\w-]+)\/?$/.exec(caminho);
  if (programa?.[1]) return { nome: 'programa', id: programa[1] };

  const licao = /^\/licao\/([\w-]+)\/?$/.exec(caminho);
  if (licao?.[1]) return { nome: 'licao', id: licao[1], passo: passoDaBusca(busca) };

  const produto = /^\/produto\/([\w-]+)\/?$/.exec(caminho);
  if (produto?.[1]) return { nome: 'produto', id: produto[1] };

  return { nome: 'inicio' };
}

export function rotaAtual(): Rota {
  return rotaDe(location.pathname, location.search);
}

/**
 * Navega sem recarregar a página. `estado` vai no `history.state` da entrada
 * nova (a lição marca ali o passo que avançou, para o "Voltar um passo" saber
 * que a entrada anterior é o passo de antes).
 */
export function irPara(caminho: string, estado: Record<string, unknown> = {}): void {
  if (caminho !== `${location.pathname}${location.search}`) {
    history.pushState(estado, '', caminho);
  }
  dispatchEvent(new Event(EVENTO));
  // Tela nova começa do topo; sem isto a lista de dias abre no meio.
  scrollTo(0, 0);
}

/**
 * Troca a entrada atual do histórico em vez de empilhar outra: o "voltar" do
 * navegador pula esta tela.
 */
export function substituirPor(caminho: string): void {
  history.replaceState({}, '', caminho);
  dispatchEvent(new Event(EVENTO));
  scrollTo(0, 0);
}

export function voltar(): void {
  history.back();
}

export function useRota(): Rota {
  const [rota, setRota] = useState<Rota>(rotaAtual);

  useEffect(() => {
    const atualizar = () => setRota(rotaAtual());
    addEventListener('popstate', atualizar);
    addEventListener(EVENTO, atualizar);
    return () => {
      removeEventListener('popstate', atualizar);
      removeEventListener(EVENTO, atualizar);
    };
  }, []);

  return rota;
}
