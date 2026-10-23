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

export type Rota =
  | { nome: 'inicio' }
  | { nome: 'entrar' }
  | { nome: 'programa'; id: string }
  | { nome: 'licao'; id: string };

const EVENTO = 'jda:rota';

export function rotaDe(caminho: string, busca: string): Rota {
  const parametros = new URLSearchParams(busca);

  // Link nosso (e-mail preenchido, ou link de acesso que não serviu mais) vai
  // direto para o login: quem veio de lá já sabe onde está.
  if (caminho === '/entrar' || parametros.has('e') || parametros.has('motivo')) {
    return { nome: 'entrar' };
  }

  const programa = /^\/programa\/([\w-]+)\/?$/.exec(caminho);
  if (programa?.[1]) return { nome: 'programa', id: programa[1] };

  const licao = /^\/licao\/([\w-]+)\/?$/.exec(caminho);
  if (licao?.[1]) return { nome: 'licao', id: licao[1] };

  return { nome: 'inicio' };
}

export function rotaAtual(): Rota {
  return rotaDe(location.pathname, location.search);
}

/** Navega sem recarregar a página. */
export function irPara(caminho: string): void {
  if (caminho !== `${location.pathname}${location.search}`) {
    history.pushState({}, '', caminho);
  }
  dispatchEvent(new Event(EVENTO));
  // Tela nova começa do topo; sem isto a lista de dias abre no meio.
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
