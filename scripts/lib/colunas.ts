/**
 * Achar a coluna do relatório pelo nome, do jeito que a Payt escreve.
 *
 * O relatório em `.xlsx` vem em português e com acento ("Código", "Data
 * Aprovação do Pagamento"). Sem tirar o acento, "Código" não casava com
 * "codigo", e a coluna da transação ficava de fora — sem ela não dá para
 * importar, porque é o `transaction_id` que deixa um reembolso futuro revogar.
 */
export function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

/**
 * Primeiro o nome exato, na ordem de preferência; só depois "contém". Na ordem
 * contrária, "Código" perderia para "Código do Checkout", que vem antes no
 * arquivo e também contém "codigo".
 */
export function acharColuna(colunas: string[], nomes: string[]): string | null {
  for (const n of nomes) {
    const achada = colunas.find((c) => normalizarNome(c) === normalizarNome(n));
    if (achada) return achada;
  }
  for (const n of nomes) {
    const achada = colunas.find((c) => normalizarNome(c).includes(normalizarNome(n)));
    if (achada) return achada;
  }
  return null;
}
