/**
 * Preço em centavos virando texto (fase 6).
 *
 * Mora fora das telas porque a loja e a página do produto mostram o mesmo
 * número, e preço escrito de dois jeitos na mesma compra é motivo de desconfiar.
 */

/**
 * `19700` → `R$ 197,00`.
 *
 * O `Intl` é criado a cada chamada em vez de ficar num módulo: são poucas
 * chamadas por tela, e um formatador guardado no topo do módulo roda no
 * carregamento do bundle, antes de a primeira tela aparecer.
 */
export function emReais(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(centavos / 100);
}
