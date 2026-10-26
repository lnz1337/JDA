/**
 * Tempo limite para um passo do lembrete (CLAUDE.md §11).
 *
 * O preparo roda quando a tela abre, antes do toque, e um dos passos é o
 * `navigator.serviceWorker.ready` — que no iPhone pode simplesmente nunca
 * resolver. Sem limite, o botão fica em "Um instante…" para sempre e a pessoa
 * não tem nem o que contar para o suporte.
 */
import type { EtapaPush } from './diagnostico';

function erroDeLimite(etapa: EtapaPush, ms: number): Error {
  const e = new Error(`${etapa} não respondeu em ${ms}ms`);
  // O `name` é o que o relatório mostra; "Error" não diria nada.
  e.name = 'TempoEsgotado';
  return e;
}

/**
 * A promessa, ou `TempoEsgotado` se ela demorar.
 *
 * O erro original passa na frente do limite: quando o passo falha de verdade, a
 * causa dele informa mais do que "demorou".
 */
export async function comLimite<T>(
  promessa: Promise<T>,
  ms: number,
  etapa: EtapaPush,
): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(erroDeLimite(etapa, ms)), ms);
      }),
    ]);
  } finally {
    // Senão o relógio sobrevive e rejeita uma promessa já resolvida, virando
    // "unhandled rejection" muito depois, longe da causa.
    if (relogio !== undefined) clearTimeout(relogio);
  }
}
