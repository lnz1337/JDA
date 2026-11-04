/**
 * Tema (claro/escuro) e tamanho da letra, **do aparelho** (docs/estilo-visual.md).
 *
 * Ficam em `localStorage`, sempre com `try/catch`: em aba privada a leitura
 * falha, e o app segue no padrão (claro, letra normal). O `index.html` aplica os
 * dois **antes da primeira pintura**, com as mesmas chaves e os mesmos valores
 * daqui, para o tema escuro não piscar branco — mudar uma coisa aqui é mudar lá
 * também.
 */
import { gravarLocal, lerLocal } from './dispositivo';

export type Tema = 'claro' | 'escuro';

export const CHAVE_TEMA = 'aparencia:tema';
export const CHAVE_LETRA = 'aparencia:letra';

/** Os quatro tamanhos, como multiplicador do rem. O padrão é o 1. */
export const TAMANHOS_DE_LETRA = [0.9, 1, 1.15, 1.3] as const;
const PADRAO_LETRA = 1;

/** `theme-color` acompanha o `fundo2` de cada tema (barra do sistema). */
export const COR_DA_BARRA: Record<Tema, string> = { claro: '#f1eadb', escuro: '#140c05' };

export function temaAtual(): Tema {
  return lerLocal(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro';
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_DA_BARRA[tema]);
}

export function trocarTema(): Tema {
  const novo: Tema = temaAtual() === 'escuro' ? 'claro' : 'escuro';
  gravarLocal(CHAVE_TEMA, novo);
  aplicarTema(novo);
  return novo;
}

/** Posição do tamanho atual na lista (0 a 3). Valor estranho volta ao padrão. */
export function indiceDaLetra(): number {
  const salvo = Number(lerLocal(CHAVE_LETRA));
  const i = TAMANHOS_DE_LETRA.indexOf(salvo as (typeof TAMANHOS_DE_LETRA)[number]);
  return i >= 0 ? i : TAMANHOS_DE_LETRA.indexOf(PADRAO_LETRA);
}

export function aplicarLetra(indice: number): number {
  const i = Math.min(Math.max(indice, 0), TAMANHOS_DE_LETRA.length - 1);
  const valor = TAMANHOS_DE_LETRA[i] ?? PADRAO_LETRA;
  document.documentElement.style.setProperty('--fs', String(valor));
  gravarLocal(CHAVE_LETRA, String(valor));
  return i;
}
