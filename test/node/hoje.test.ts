import { describe, expect, it } from 'vitest';
import { horaNoFuso, passosFeitosDoDia, periodoDoDia, saudacao } from '../../src/shared/hoje.ts';

describe('saudação da Home', () => {
  it.each([
    [4, 'Boa noite'],
    [5, 'Bom dia'],
    [11, 'Bom dia'],
    [12, 'Boa tarde'],
    [17, 'Boa tarde'],
    [18, 'Boa noite'],
    [23, 'Boa noite'],
    [0, 'Boa noite'],
  ])('%ih → %s', (hora, periodo) => {
    expect(periodoDoDia(hora)).toBe(periodo);
  });

  it('usa o primeiro nome, com a caixa arrumada', () => {
    expect(saudacao(8, 'ELIANA DE SOUZA')).toBe('Bom dia, Eliana');
    expect(saudacao(14, 'Maria de Fátima')).toBe('Boa tarde, Maria');
  });

  it('sem nome, só a saudação com exclamação', () => {
    expect(saudacao(8, null)).toBe('Bom dia!');
    expect(saudacao(20, '   ')).toBe('Boa noite!');
  });
});

describe('hora no fuso da pessoa', () => {
  // 05/11/2026 às 10:30 UTC.
  const agora = new Date('2026-11-05T10:30:00Z');

  it('Brasília está 3 horas atrás do UTC', () => {
    expect(horaNoFuso('America/Sao_Paulo', agora)).toBe(7);
  });

  it('respeita outro fuso da conta', () => {
    expect(horaNoFuso('America/Manaus', agora)).toBe(6);
    expect(horaNoFuso('Europe/Lisbon', agora)).toBe(10);
  });

  it('meia-noite é 0, não 24', () => {
    expect(horaNoFuso('UTC', new Date('2026-11-05T00:10:00Z'))).toBe(0);
  });

  it('fuso inválido ou vazio cai no de Brasília', () => {
    expect(horaNoFuso('Lua/Crateras', agora)).toBe(7);
    expect(horaNoFuso(undefined, agora)).toBe(7);
  });
});

describe('passos feitos do dia', () => {
  it('lição concluída marca os três, mesmo sem nada no aparelho', () => {
    expect([...passosFeitosDoDia(true, new Set())].sort()).toEqual([1, 2, 3]);
  });

  it('sem concluir, só o que o aparelho guardou', () => {
    expect([...passosFeitosDoDia(false, new Set([1]))]).toEqual([1]);
    expect([...passosFeitosDoDia(false, new Set([2, 1]))].sort()).toEqual([1, 2]);
    expect([...passosFeitosDoDia(false, new Set())]).toEqual([]);
  });

  it('o 3 nunca vem do aparelho', () => {
    expect(passosFeitosDoDia(false, new Set([3])).has(3)).toBe(false);
  });
});
