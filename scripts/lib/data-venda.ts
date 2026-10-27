/**
 * Data de venda vinda da exportação em CSV da Payt.
 *
 * O formato que a Payt manda no postback já é conhecido (§7): horário de
 * Brasília, sem fuso. A exportação também pode sair no formato brasileiro,
 * `dd/mm/aaaa`, que `Date.parse` lê errado — ele interpreta como mês/dia e
 * inverte 05/10 com 10/05 sem reclamar.
 *
 * Data que não dá para ler devolve null, e quem chama decide o que fazer; aqui
 * ninguém adivinha.
 */
import { paytParaIso } from '../../src/worker/lib/datas.ts';

const DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const SERIAL_EXCEL = /^\d{5}(?:\.\d+)?$/;
const SO_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dia sem hora é o **começo** do dia, nos dois formatos. O `paytParaIso` usa o
 * fim do dia porque lá a data decide até quando vale uma assinatura cancelada
 * (§18); aqui ela só diz quando a venda aconteceu, e "vendido em 5 de outubro"
 * não é 23:59 de 5 de outubro. Sem isso, `05/10/2026` e `2026-10-05` sairiam com
 * um dia de diferença, dependendo de como o CSV veio.
 */
/**
 * Número de série do Excel: dias desde 30/12/1899, com a hora na fração.
 *
 * Aparece quando a coluna de data não tem formato de data no arquivo, e o leitor
 * entrega o número cru. Como a data do Excel, o número não tem fuso: é o relógio
 * de quem exportou, Brasília. Cinco dígitos cobrem de 1927 a 2173, o que separa
 * data de outro número qualquer.
 */
function serialExcelParaTexto(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400) * 1000;
  const d = new Date(ms);
  const dois = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())} ` +
    `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())}`
  );
}

export function dataDaVendaParaIso(valor: string | null | undefined): string | null {
  const texto = (valor ?? '').trim();
  if (!texto) return null;

  if (SERIAL_EXCEL.test(texto)) return paytParaIso(serialExcelParaTexto(Number(texto)));

  const br = DATA_BR.exec(texto);
  if (br) {
    const [, dia, mes, ano, hora = '00', min = '00', seg = '00'] = br;
    // Reaproveita a normalização da §7: monta no formato que ela já entende.
    return paytParaIso(`${ano}-${mes}-${dia} ${hora}:${min}:${seg}`);
  }

  if (SO_DATA_ISO.test(texto)) return paytParaIso(`${texto} 00:00:00`);

  return paytParaIso(texto);
}
