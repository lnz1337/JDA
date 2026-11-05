/**
 * A lição em passos (docs/estilo-visual.md, "Lição em passos").
 *
 * Usado dos dois lados: o servidor separa o corpo em passos, e o client lê o
 * passo da URL. Sem nada de navegador nem de banco aqui, para poder testar com o
 * corpo real do seed.
 */

/** As quatro partes do dia, já sem os rótulos. */
export interface Passos {
  leitura: string;
  reflexao: string;
  pratica: string;
  intencao: string;
}

/** Quantas telas tem a lição em passos: a oração, a prática e a intenção. */
export const TOTAL_DE_PASSOS = 3;

/*
 * Os três rótulos exatos que o `conteudo/gerar_seed.py` escreve. Exatos de
 * propósito: um corpo que não segue o formato não pode virar passo pela metade
 * (reflexão vazia, prática com a intenção dentro) — ele fica numa tela só.
 */
const LEITURA = '**Leitura do dia:**';
const PRATICA = '**Prática de hoje:**';
const INTENCAO = '**Intenção:**';

/**
 * Separa o `body_md` da jornada em leitura, reflexão, prática e intenção.
 *
 * ```
 * **Leitura do dia:** <referência>
 *
 * <reflexão>
 *
 * **Prática de hoje:** <prática>
 *
 * **Intenção:** <intenção>
 * ```
 *
 * Devolve `null` quando falta um rótulo, quando eles vêm fora de ordem ou
 * repetidos, ou quando alguma parte fica vazia: a lição continua numa tela só.
 */
export function separarPassos(bodyMd: string | null | undefined): Passos | null {
  const corpo = bodyMd?.replace(/\r\n/g, '\n').trim();
  if (!corpo) return null;

  const contar = (rotulo: string) => corpo.split(rotulo).length - 1;
  if (contar(LEITURA) !== 1 || contar(PRATICA) !== 1 || contar(INTENCAO) !== 1) return null;

  const iLeitura = corpo.indexOf(LEITURA);
  const iPratica = corpo.indexOf(PRATICA);
  const iIntencao = corpo.indexOf(INTENCAO);
  // A leitura abre o corpo; nada de texto solto antes dela.
  if (iLeitura !== 0 || !(iLeitura < iPratica && iPratica < iIntencao)) return null;

  // A referência é o resto da linha do rótulo; a reflexão, o que vem até a prática.
  const blocoLeitura = corpo.slice(LEITURA.length, iPratica);
  const quebra = blocoLeitura.indexOf('\n');
  const leitura = (quebra < 0 ? blocoLeitura : blocoLeitura.slice(0, quebra)).trim();
  const reflexao = quebra < 0 ? '' : blocoLeitura.slice(quebra + 1).trim();
  const pratica = corpo.slice(iPratica + PRATICA.length, iIntencao).trim();
  const intencao = corpo.slice(iIntencao + INTENCAO.length).trim();

  if (!leitura || !reflexao || !pratica || !intencao) return null;
  return { leitura, reflexao, pratica, intencao };
}

/** O passo pedido na URL (`?passo=2`). Sem ele, ou fora de 1 a 3, é o 1. */
export function passoDaBusca(busca: string): number {
  const n = Number(new URLSearchParams(busca).get('passo'));
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_DE_PASSOS ? n : 1;
}

/** "Libera amanhã" / "Libera em 5 dias": dia bloqueado sempre diz quando abre (§6). */
export function textoDeLiberacao(dias: number | undefined): string {
  if (dias === 1) return 'Libera amanhã';
  if (dias && dias > 1) return `Libera em ${dias} dias`;
  return 'Libera em breve';
}

/** "🕐 7 min": a duração arredondada para cima. Sem duração, `null`. */
export function minutosDe(segundos: number | null | undefined): number | null {
  if (!segundos || segundos <= 0) return null;
  return Math.ceil(segundos / 60);
}
