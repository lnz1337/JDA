import { describe, expect, it } from 'vitest';
import { dataDaVendaParaIso } from '../../scripts/lib/data-venda.ts';

describe('data de venda do CSV', () => {
  it('lê o formato da Payt (Brasília, sem fuso)', () => {
    expect(dataDaVendaParaIso('2026-10-21 19:06:20.000000')).toBe('2026-10-21T22:06:20.000Z');
  });

  it('lê o formato brasileiro sem inverter dia e mês', () => {
    // 05/10 é 5 de outubro. Date.parse leria como 10 de maio e não reclamaria.
    expect(dataDaVendaParaIso('05/10/2026 14:30')).toBe('2026-10-05T17:30:00.000Z');
    expect(dataDaVendaParaIso('25/12/2025 08:00:15')).toBe('2025-12-25T11:00:15.000Z');
  });

  it('dia sem hora é o começo do dia, no formato que vier', () => {
    // Os dois são 5 de outubro: se um virasse fim do dia, a ordenação por data
    // de compra sairia com um dia de diferença só por causa do formato do CSV.
    expect(dataDaVendaParaIso('05/10/2026')).toBe('2026-10-05T03:00:00.000Z');
    expect(dataDaVendaParaIso('2026-10-05')).toBe('2026-10-05T03:00:00.000Z');
  });

  it('devolve null para o que não dá para ler', () => {
    for (const v of ['', '   ', 'ontem', '31/31/2026', null, undefined]) {
      expect(dataDaVendaParaIso(v)).toBeNull();
    }
  });
});
