/**
 * A chave pública VAPID virando bytes para o `subscribe` (CLAUDE.md §11).
 *
 * Mora fora do `dispositivo.ts` porque não depende de DOM nenhum — só de `atob`
 * — e assim dá para testar no runtime do Workers, junto do resto.
 */

/**
 * `BASE64URL` → `Uint8Array`, que é o que `subscribe` aceita como chave.
 *
 * Limpa **antes** de medir. O `atob` é estrito, e um BOM dentro da chave — foi o
 * que um `wrangler secret put` por pipe gravou no segredo do staging — derrubava
 * o `subscribe` do iPhone com `InvalidCharacterError`, mensagem que não diz de
 * onde veio. E, como o padding sai do tamanho, a sujeira ainda fazia a conta dar
 * 88 em vez de 87, e o `=` que falta não era acrescentado.
 *
 * Fora do alfabeto, recusa com mensagem que aponta para a chave: este erro vai
 * para a tela em staging e para o `push_erro_cliente`.
 */
export function chaveParaBytes(base64url: string): Uint8Array {
  const limpa = base64url.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(limpa)) {
    const e = new Error('chave de push fora do alfabeto base64url');
    e.name = 'ChaveInvalida';
    throw e;
  }

  const base64 = limpa.replace(/-/g, '+').replace(/_/g, '/');
  const cru = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(cru, (c) => c.charCodeAt(0));
}
