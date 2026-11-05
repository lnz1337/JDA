/**
 * Regras da Home "Hoje" (docs/estilo-visual.md), sem nada de navegador: a
 * saudação pelo horário no fuso da pessoa e os três passos do dia.
 */
import { primeiroNome } from './nome';

const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * A hora (0 a 23) agora, no fuso da conta. Fuso inválido no cadastro cai no de
 * Brasília em vez de quebrar a Home: a saudação é enfeite, não pode derrubar a tela.
 */
export function horaNoFuso(fuso: string | null | undefined, agora: Date = new Date()): number {
  const ler = (tz: string) =>
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' })
        .formatToParts(agora)
        .find((p) => p.type === 'hour')?.value,
    );
  try {
    return ler(fuso || FUSO_PADRAO) % 24;
  } catch {
    return ler(FUSO_PADRAO) % 24;
  }
}

/** "Bom dia" das 5h às 11h, "Boa tarde" das 12h às 17h, "Boa noite" das 18h às 4h. */
export function periodoDoDia(hora: number): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  if (hora >= 5 && hora <= 11) return 'Bom dia';
  if (hora >= 12 && hora <= 17) return 'Boa tarde';
  return 'Boa noite';
}

/** "Boa tarde, Eliana" ("ELIANA" da Payt vira "Eliana"); sem nome, "Boa tarde!". */
export function saudacao(hora: number, nome: string | null | undefined): string {
  const periodo = periodoDoDia(hora);
  const primeiro = primeiroNome(nome);
  return primeiro ? `${periodo}, ${primeiro}` : `${periodo}!`;
}

/**
 * Que passos do dia estão feitos, para a lista "A sua jornada de hoje".
 *
 * O 1 (ouviu a oração) e o 2 (passou pela prática) vêm do aparelho; o 3 é o
 * servidor dizendo que a lição está concluída. Lição concluída marca os três:
 * quem concluiu em outro celular não pode ver a lista pela metade.
 */
export function passosFeitosDoDia(
  concluida: boolean,
  locais: ReadonlySet<number>,
): Set<1 | 2 | 3> {
  if (concluida) return new Set([1, 2, 3]);
  const feitos = new Set<1 | 2 | 3>();
  if (locais.has(1)) feitos.add(1);
  if (locais.has(2)) feitos.add(2);
  return feitos;
}
