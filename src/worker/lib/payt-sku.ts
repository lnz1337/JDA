/**
 * As formas do sku da Payt que valem procurar no `product_payt_sku`.
 *
 * O postback manda o sku sozinho (`853b4781f48478`, observado). O relatório em
 * `.xlsx` manda com um prefixo e hífen (`6a44473d38700-853b4781f48478`). Os
 * dois são o mesmo produto, então o mapa guarda só o sku, e daqui saem as duas
 * formas para a busca: o valor inteiro e o pedaço depois do último hífen.
 *
 * O inteiro vem junto porque sku de teste pode ter hífen de verdade (as
 * fixtures usam o slug do produto, `jornada-meu-anjo`).
 */
export function formasDoSku(valor: string | null | undefined): string[] {
  const inteiro = (valor ?? '').trim();
  if (!inteiro) return [];

  const fim = inteiro.slice(inteiro.lastIndexOf('-') + 1);
  return fim && fim !== inteiro ? [inteiro, fim] : [inteiro];
}
