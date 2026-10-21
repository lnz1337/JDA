/** Datas no banco são sempre ISO 8601 UTC (CLAUDE.md §18). */
export function agoraIso(): string {
  return new Date().toISOString();
}

/** Soma dias a uma data ISO; devolve null se a entrada não for data válida. */
export function somarDias(iso: string | null | undefined, dias: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fuso de Brasília. O Brasil não tem mais horário de verão desde 2019, então o
 * deslocamento é fixo — se um dia voltar, isto aqui precisa virar Intl.
 */
const FUSO_BRASIL = '-03:00';

/**
 * Converte data da Payt para ISO UTC. Observado no postback real: ela manda
 * horário de Brasília, sem fuso nenhum.
 *
 *   "2026-10-21 19:06:20.000000" -> "2026-10-21T22:06:20.000Z"
 *   "2026-11-21"                 -> "2026-11-22T02:59:59.000Z"  (fim do dia em -03:00)
 *
 * Data sem hora vira o FIM do dia de propósito: `next_charge_at` nesse formato
 * decide até quando vale uma assinatura cancelada (§6), e tratar como 00:00
 * tiraria do assinante o último dia que ele pagou.
 */
export function paytParaIso(valor: string | null | undefined): string | null {
  const texto = (valor ?? '').trim();
  if (!texto) return null;

  const emIso = (s: string): string | null => {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };

  // Já veio com fuso (Z ou ±hh:mm): só normaliza o formato.
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(texto)) return emIso(texto);

  const comHora = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(texto);
  if (comHora) return emIso(`${comHora[1]}T${comHora[2]}${FUSO_BRASIL}`);

  const soData = /^(\d{4}-\d{2}-\d{2})$/.exec(texto);
  if (soData) return emIso(`${soData[1]}T23:59:59${FUSO_BRASIL}`);

  return null;
}
