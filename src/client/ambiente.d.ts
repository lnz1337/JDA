/**
 * Constantes que o `define` do Vite (vite.config.ts) troca no build, por
 * ambiente. Não existem em tempo de execução: o bundler as substitui por
 * literal, então `if (__DIAGNOSTICO__)` sai do bundle de produção inteiro.
 */

/** Staging e dev: a tela pode mostrar detalhe técnico de falha. */
declare const __DIAGNOSTICO__: boolean;

/**
 * Só no staging: data e hora do build ("05/11 15:42"), no cabeçalho. Muda a
 * cada build, então cada deploy de staging troca o service worker — é o que
 * deixa testar a troca de versão no celular. Em produção é vazio e não muda o
 * bundle: deploy só de Worker não faz ninguém recarregar.
 */
declare const __VERSAO__: string;
