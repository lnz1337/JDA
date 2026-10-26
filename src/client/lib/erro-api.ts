/**
 * O erro que uma chamada à API vira.
 *
 * Mora fora do `api.ts` porque não depende de `fetch` nem de mais nada do
 * navegador: assim o `diagnostico.ts` pode usá-lo sem arrastar o `api.ts` para
 * dentro do projeto de teste do Worker, onde o `RequestInit` é o da Cloudflare e
 * não conhece `keepalive`.
 */
export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
    /**
     * O corpo inteiro da resposta. O `/api/push/confirmacao` manda nele o
     * status e o motivo que o serviço de push devolveu (um 403 `BadJwtToken` da
     * Apple, por exemplo), e só o `codigo` perderia isso.
     */
    readonly corpo: Record<string, unknown> = {},
  ) {
    super(codigo);
  }
}
