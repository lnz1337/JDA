/**
 * Todo segredo do Worker é lido por aqui (CLAUDE.md §15).
 *
 * `wrangler secret put` recebendo o valor por pipe no PowerShell grava UTF-8
 * **com BOM**, e o U+FEFF entra no segredo. Já custou caro uma vez: o
 * `VAPID_PUBLIC_KEY` do staging nasceu com BOM, o `atob` do Safari recusou a
 * chave e o `subscribe` do iPhone morria com `InvalidCharacterError` — mensagem
 * que não aponta para segredo nenhum. A `ADMIN_API_KEY`, a
 * `CAMPAIGN_SIGNING_KEY` e o par VAPID dos dois ambientes foram gravados do
 * mesmo jeito, então a limpeza não pode ficar só no caminho do push.
 *
 * BOM e espaço nas pontas nunca fazem parte de um segredo, e o `trim` do
 * JavaScript come o U+FEFF junto com o resto. Um ponto só, para não depender de
 * cada chamador lembrar — e para a próxima chave gravada torta não virar outra
 * caçada.
 */
import type { Secrets } from './types';

export function segredo(env: Partial<Secrets>, nome: keyof Secrets): string {
  return (env[nome] ?? '').trim();
}
