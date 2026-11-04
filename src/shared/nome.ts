/**
 * Como o nome aparece na tela, sem mexer no que está gravado.
 *
 * A Payt às vezes manda o nome todo em maiúsculas ("ELIANA DE SOUZA"), e "Bom
 * dia, ELIANA" parece grito. Nome que já veio com caixa mista fica como a pessoa
 * escreveu: "Maria de Fátima" não vira "Maria De Fátima".
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function nomeParaExibir(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';
  const temLetra = /\p{L}/u.test(limpo);
  if (!temLetra || limpo !== limpo.toLocaleUpperCase('pt-BR')) return limpo;

  return limpo
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((p, i) =>
      // 'de', 'da', 'dos'… ficam minúsculos no meio: 'Maria de Fátima'.
      i > 0 && PARTICULAS.has(p) ? p : p[0]!.toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

/** Só o primeiro nome, para a saudação. */
export function primeiroNome(nome: string | null | undefined): string {
  return nomeParaExibir(nome).split(' ')[0] ?? '';
}
