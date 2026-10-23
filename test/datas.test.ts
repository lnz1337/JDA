import { diasDesde } from '../src/worker/lib/datas';
import { describe, expect, it } from 'vitest';

describe('diasDesde (dia do calendário, no fuso do usuário)', () => {
  const SP = 'America/Sao_Paulo';

  it('mesmo dia é zero', () => {
    expect(diasDesde('2026-10-23T12:00:00.000Z', SP, '2026-10-23T23:00:00.000Z')).toBe(0);
  });

  it('conta virada de dia, não 24 horas', () => {
    // 23h de Brasília para 00h30: uma hora e meia depois, mas é o dia seguinte —
    // e é o dia do calendário que libera a lição (§6).
    expect(diasDesde('2026-10-23T02:00:00.000Z', SP, '2026-10-23T03:30:00.000Z')).toBe(1);
  });

  it('20 horas depois, no mesmo dia, continua zero', () => {
    expect(diasDesde('2026-10-23T03:30:00.000Z', SP, '2026-10-23T23:30:00.000Z')).toBe(0);
  });

  it('usa o fuso do usuário, não o do servidor', () => {
    // O mesmo instante é 23/10 em São Paulo e 24/10 em Tóquio.
    const inicio = '2026-10-23T12:00:00.000Z';
    const depois = '2026-10-23T16:00:00.000Z';
    expect(diasDesde(inicio, SP, depois)).toBe(0);
    expect(diasDesde(inicio, 'Asia/Tokyo', depois)).toBe(1);
  });

  it('conta os dias corridos de uma jornada inteira', () => {
    expect(diasDesde('2026-10-01T13:00:00.000Z', SP, '2026-10-19T13:00:00.000Z')).toBe(18);
  });

  it('fuso inválido cai no padrão em vez de explodir', () => {
    expect(diasDesde('2026-10-23T12:00:00.000Z', 'Marte/Olympus', '2026-10-24T12:00:00.000Z')).toBe(
      1,
    );
  });

  it('data inválida devolve zero, sem travar a jornada', () => {
    expect(diasDesde('nao-e-data', SP, '2026-10-24T12:00:00.000Z')).toBe(0);
  });
});

import { paytParaIso, somarDias } from '../src/worker/lib/datas';

describe('paytParaIso', () => {
  it('trata data com hora como horário de Brasília', () => {
    // Formato observado no postback real: "Y-m-d H:i:s.ffffff", sem fuso.
    expect(paytParaIso('2026-10-21 19:06:20.000000')).toBe('2026-10-21T22:06:20.000Z');
  });

  it('aceita a mesma data sem os microssegundos', () => {
    expect(paytParaIso('2026-10-21 19:06:20')).toBe('2026-10-21T22:06:20.000Z');
  });

  it('usa o fim do dia quando vem só a data', () => {
    // Quem cancelou não pode perder o último dia já pago (§6).
    expect(paytParaIso('2026-11-21')).toBe('2026-11-22T02:59:59.000Z');
  });

  it('deixa passar data que já tem fuso', () => {
    expect(paytParaIso('2026-10-21T22:06:20Z')).toBe('2026-10-21T22:06:20.000Z');
    expect(paytParaIso('2026-10-21 19:06:20-03:00')).toBe('2026-10-21T22:06:20.000Z');
  });

  it('devolve null para vazio ou lixo', () => {
    expect(paytParaIso(null)).toBeNull();
    expect(paytParaIso('')).toBeNull();
    expect(paytParaIso('   ')).toBeNull();
    expect(paytParaIso('ontem')).toBeNull();
    expect(paytParaIso('21/11/2026')).toBeNull();
  });

  it('o resultado continua comparável com agoraIso por string', () => {
    // É disso que assinaturaValida depende: ordenação lexicográfica entre ISOs.
    const normalizada = paytParaIso('2026-11-21 15:00:00.000000') ?? '';
    expect(normalizada > '2026-10-21T22:00:00.000Z').toBe(true);
    expect(normalizada < '2026-12-01T00:00:00.000Z').toBe(true);
  });
});

describe('somarDias', () => {
  it('soma sobre data normalizada', () => {
    expect(somarDias('2026-11-21T18:00:00.000Z', 3)).toBe('2026-11-24T18:00:00.000Z');
  });

  it('devolve null para data inválida', () => {
    expect(somarDias('nao e data', 3)).toBeNull();
    expect(somarDias(null, 3)).toBeNull();
  });
});
