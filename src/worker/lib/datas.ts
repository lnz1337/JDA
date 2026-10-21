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
