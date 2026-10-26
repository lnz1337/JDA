/**
 * Constantes que o `define` do Vite (vite.config.ts) troca no build, por
 * ambiente. Não existem em tempo de execução: o bundler as substitui por
 * literal, então `if (__DIAGNOSTICO__)` sai do bundle de produção inteiro.
 */

/** Staging e dev: a tela pode mostrar detalhe técnico de falha. */
declare const __DIAGNOSTICO__: boolean;
