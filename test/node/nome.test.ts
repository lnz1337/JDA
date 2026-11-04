import { describe, expect, it } from 'vitest';
import { nomeParaExibir, primeiroNome } from '../../src/shared/nome.ts';

describe('nome na tela', () => {
  it('nome todo em maiúsculas vira primeira letra maiúscula', () => {
    expect(nomeParaExibir('ELIANA')).toBe('Eliana');
    expect(nomeParaExibir('MARIA DE FÁTIMA DOS SANTOS')).toBe('Maria de Fátima dos Santos');
  });

  it('nome com caixa mista fica como a pessoa escreveu', () => {
    expect(nomeParaExibir('Maria De Lourdes')).toBe('Maria De Lourdes');
    expect(nomeParaExibir('josé')).toBe('josé');
  });

  it('espaço sobrando sai; vazio é vazio', () => {
    expect(nomeParaExibir('  ANA   PAULA ')).toBe('Ana Paula');
    expect(nomeParaExibir(null)).toBe('');
  });

  it('primeiro nome para a saudação', () => {
    expect(primeiroNome('ELIANA DE SOUZA')).toBe('Eliana');
    expect(primeiroNome('')).toBe('');
  });
});
