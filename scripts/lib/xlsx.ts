/**
 * Leitura do relatório de vendas da Payt direto do `.xlsx`.
 *
 * O arquivo não passa pelo Excel de propósito: o Excel em português salva CSV
 * com ponto e vírgula, pode transformar telefone em notação científica e mexer
 * na data, e o "CSV UTF-8" dele põe BOM. Lendo o `.xlsx`, o que chega aqui é o
 * que a Payt exportou.
 *
 * Devolve o mesmo formato do `lerCsv`, para o importador não saber de onde veio.
 */
import readExcelFile from 'read-excel-file/node';

type Celula = string | number | boolean | Date | null | undefined;

const dois = (n: number) => String(n).padStart(2, '0');

/**
 * Data de célula do Excel como texto de relógio, **sem fuso**.
 *
 * O Excel guarda a data como número, sem fuso nenhum: é a hora que estava no
 * relógio de quem exportou — Brasília, na Payt. A biblioteca entrega isso como
 * um `Date` em UTC, então os campos UTC dele são o relógio de Brasília. Daqui
 * sai no formato que o `dataDaVendaParaIso` já lê como horário de Brasília.
 */
export function dataDeCelula(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())} ` +
    `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())}`
  );
}

export function celulaParaTexto(v: Celula): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : dataDeCelula(v);
  return String(v).trim();
}

export async function lerXlsx(
  caminho: string,
): Promise<{ colunas: string[]; linhas: Record<string, string>[]; planilhas: string[] }> {
  /*
   * Número fica como o texto que está no arquivo. Telefone com 13 dígitos e
   * código de transação numérico não podem passar por `Number`: o primeiro
   * perderia precisão e o segundo, zero à esquerda.
   */
  const planilhas = await readExcelFile(caminho, { parseNumber: (s: string) => s });
  const primeira = planilhas[0];
  const dados = (primeira?.data ?? []) as Celula[][];

  const colunas = (dados[0] ?? []).map((c) => celulaParaTexto(c));
  const linhas = dados
    .slice(1)
    .map((l) => l.map((c) => celulaParaTexto(c)))
    .filter((l) => l.some((v) => v !== ''))
    .map((l) => Object.fromEntries(colunas.map((c, i) => [c, l[i] ?? ''])));

  return { colunas, linhas, planilhas: planilhas.map((p) => p.sheet) };
}
