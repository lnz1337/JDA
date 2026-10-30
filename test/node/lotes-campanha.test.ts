import { describe, expect, it } from 'vitest';
import { enviarEmLotes, type Chamar, type RespostaCampanha } from '../../scripts/lib/lotes.ts';

/**
 * A onda em lotes do `campanha:anuncio`.
 *
 * Em 30/10 a onda de 200 numa chamada só estourou o timeout de 300 s do fetch,
 * e a Cloudflare cortou o Worker em 108. O falso Worker daqui guarda a fila e
 * registra cada chamada, para conferir o que o script pede e quando ele para.
 */
function falsoWorker(fila: number, opcoes: { falhaACada?: number; teto?: number } = {}) {
  const chamadas: { limite: number; dryRun: boolean }[] = [];
  let restante = fila;
  let enviadosHoje = 0;

  const chamar: Chamar = async (limite, dryRun) => {
    chamadas.push({ limite, dryRun });
    if (opcoes.teto !== undefined && limite > opcoes.teto) {
      return { ok: false, error: `limite ${limite} acima do máximo agora, que é ${opcoes.teto}.` };
    }
    const n = Math.min(limite, restante);
    if (dryRun) return { ok: true, enviados: n, falhas: 0 };

    let falhas = 0;
    if (opcoes.falhaACada) falhas = Math.floor(n / opcoes.falhaACada);
    restante -= n;
    enviadosHoje += n - falhas;
    return { ok: true, enviados: n - falhas, falhas, enviadosHoje, cotaRestante: 1000 - enviadosHoje };
  };

  return { chamar, chamadas };
}

describe('enviarEmLotes', () => {
  it('confere o total com dry-run antes e manda em lotes de até 40', async () => {
    const w = falsoWorker(1000);
    const r = await enviarEmLotes(200, w.chamar);

    expect(r).toMatchObject({ motivo: 'completa', selecionados: 200, enviados: 200, falhas: 0, lotes: 5 });
    expect(w.chamadas[0]).toEqual({ limite: 200, dryRun: true });
    expect(w.chamadas.slice(1).every((c) => !c.dryRun && c.limite <= 40)).toBe(true);
    expect(w.chamadas.slice(1).reduce((s, c) => s + c.limite, 0)).toBe(200);
  });

  it('o último lote pede só o que falta', async () => {
    const w = falsoWorker(1000);
    await enviarEmLotes(92, w.chamar);
    expect(w.chamadas.slice(1).map((c) => c.limite)).toEqual([40, 40, 12]);
  });

  /*
   * A trava de "onda no máximo o dobro da anterior" mora no Worker e só vê o
   * limite de cada chamada. Sem a conferência do total, lotes de 40 passariam
   * uma onda de 1.000 por baixo da trava.
   */
  it('onda acima do teto é recusada antes de enviar qualquer coisa', async () => {
    const w = falsoWorker(1000, { teto: 400 });
    const r = await enviarEmLotes(800, w.chamar);

    expect(r.motivo).toBe('recusada');
    expect(r.detalhe).toContain('acima do máximo');
    expect(r.enviados).toBe(0);
    expect(w.chamadas).toEqual([{ limite: 800, dryRun: true }]);
  });

  it('fila menor que o pedido manda só o que existe', async () => {
    const w = falsoWorker(55);
    const r = await enviarEmLotes(200, w.chamar);
    expect(r).toMatchObject({ motivo: 'completa', selecionados: 55, enviados: 55 });
  });

  it('fila vazia não envia nada', async () => {
    const w = falsoWorker(0);
    const r = await enviarEmLotes(200, w.chamar);
    expect(r.motivo).toBe('fila_vazia');
    expect(w.chamadas).toHaveLength(1);
  });

  it('para quando a fila some no meio (lote sem envio) em vez de repetir para sempre', async () => {
    let n = 0;
    const chamar: Chamar = async (limite, dryRun): Promise<RespostaCampanha> => {
      n += 1;
      if (dryRun) return { ok: true, enviados: limite };
      return { ok: true, enviados: n === 2 ? limite : 0, falhas: 0 };
    };
    const r = await enviarEmLotes(100, chamar);
    expect(r).toMatchObject({ motivo: 'fila_vazia', enviados: 40, lotes: 2 });
  });

  /*
   * O Worker corta acima de 5% depois de 10 envios, mas contando só o lote.
   * Um lote de 40 com 2 falhas fica em 5% (não passa), e um último lote de 5
   * nem chega à amostra mínima: somada, a onda está em 3/45, 6,7%.
   */
  it('corta pela taxa de falha somada dos lotes', async () => {
    const chamar: Chamar = async (limite, dryRun) => {
      if (dryRun) return { ok: true, enviados: limite };
      return limite === 40 ? { ok: true, enviados: 38, falhas: 2 } : { ok: true, enviados: 4, falhas: 1 };
    };
    const r = await enviarEmLotes(45, chamar);
    expect(r).toMatchObject({ motivo: 'taxa_de_falha', enviados: 42, falhas: 3, lotes: 2 });
  });

  it('5% cravado não corta', async () => {
    const w = falsoWorker(1000, { falhaACada: 20 });
    const r = await enviarEmLotes(200, w.chamar);
    expect(r).toMatchObject({ motivo: 'completa', enviados: 190, falhas: 10, lotes: 5 });
  });

  it('respeita o parouPorFalha do Worker', async () => {
    const chamar: Chamar = async (limite, dryRun) =>
      dryRun ? { ok: true, enviados: limite } : { ok: true, enviados: 9, falhas: 3, parouPorFalha: true };
    const r = await enviarEmLotes(200, chamar);
    expect(r).toMatchObject({ motivo: 'taxa_de_falha', enviados: 9, falhas: 3, lotes: 1 });
  });

  it('erro de rede no meio para e não tenta de novo', async () => {
    let lotes = 0;
    const chamar: Chamar = async (limite, dryRun) => {
      if (dryRun) return { ok: true, enviados: limite };
      lotes += 1;
      if (lotes === 2) {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
      }
      return { ok: true, enviados: limite, falhas: 0 };
    };
    const r = await enviarEmLotes(200, chamar);

    expect(r).toMatchObject({ motivo: 'erro_de_rede', enviados: 40, lotes: 1 });
    expect(r.detalhe).toContain('UND_ERR_HEADERS_TIMEOUT');
    expect(lotes).toBe(2);
  });

  it('recusa do Worker num lote (chave errada, cota) para na hora', async () => {
    const chamar: Chamar = async (limite, dryRun) =>
      dryRun ? { ok: true, enviados: limite } : { ok: false, error: 'nao_autorizado' };
    const r = await enviarEmLotes(80, chamar);
    expect(r).toMatchObject({ motivo: 'recusada', detalhe: 'nao_autorizado', enviados: 0 });
  });
});
