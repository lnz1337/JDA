import { describe, expect, it } from 'vitest';
import { comLimite } from '../src/client/lib/limite';

/**
 * O preparo do lembrete roda na abertura da tela (CLAUDE.md §11). Sem tempo
 * limite, um `serviceWorker.ready` que nunca resolve deixaria o botão em "Um
 * instante…" para sempre — e no iPhone isso foi o que aconteceu.
 */
describe('comLimite', () => {
  it('devolve o valor quando chega em tempo', async () => {
    await expect(comLimite(Promise.resolve('pronto'), 500, 'chave')).resolves.toBe('pronto');
  });

  it('rejeita com TempoEsgotado quando estoura', async () => {
    const nunca = new Promise<string>(() => {});
    await expect(comLimite(nunca, 20, 'service_worker')).rejects.toMatchObject({
      name: 'TempoEsgotado',
    });
  });

  it('a mensagem diz qual etapa travou', async () => {
    const nunca = new Promise<string>(() => {});
    await comLimite(nunca, 20, 'service_worker').catch((e: Error) => {
      expect(e.message).toContain('service_worker');
    });
  });

  it('preserva o erro original em vez de trocar pelo limite', async () => {
    const culpado = new Error('recusado');
    culpado.name = 'AbortError';
    await expect(comLimite(Promise.reject(culpado), 500, 'assinar')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('não deixa o relógio pendurado depois de resolver', async () => {
    // Se o setTimeout sobrevivesse, ele rejeitaria uma promessa já resolvida e
    // viraria "unhandled rejection" muito depois, longe da causa.
    let pendentes = 0;
    const setOriginal = globalThis.setTimeout;
    const clearOriginal = globalThis.clearTimeout;
    globalThis.setTimeout = ((f: () => void, ms: number) => {
      pendentes += 1;
      return setOriginal(f, ms);
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {
      pendentes -= 1;
      return clearOriginal(id);
    }) as typeof clearTimeout;

    try {
      await comLimite(Promise.resolve(1), 1000, 'chave');
      expect(pendentes).toBe(0);
    } finally {
      globalThis.setTimeout = setOriginal;
      globalThis.clearTimeout = clearOriginal;
    }
  });
});
