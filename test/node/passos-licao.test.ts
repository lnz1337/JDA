import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { minutosDe, passoDaBusca, separarPassos, textoDeLiberacao } from '../../src/shared/licao.ts';

/**
 * A lição em passos (docs/estilo-visual.md). O teste usa o `body_md` **real** do
 * seed: o formato é do pipeline de conteúdo, e se ele mudar é aqui que aparece.
 */
const jornada = JSON.parse(readFileSync('seed/jornada-19-dias.json', 'utf8')) as {
  lessons: Array<{ id: string; day: number; body_md: string }>;
};
const produtos = JSON.parse(readFileSync('seed/produtos.json', 'utf8')) as {
  lessons: Array<{ id: string; body_md: string }>;
};

describe('separarPassos com o seed real', () => {
  it('separa os 19 dias da jornada, sem sobra de rótulo', () => {
    expect(jornada.lessons).toHaveLength(19);
    for (const licao of jornada.lessons) {
      const passos = separarPassos(licao.body_md);
      expect(passos, licao.id).not.toBeNull();
      for (const parte of Object.values(passos ?? {})) {
        expect(parte, licao.id).not.toContain('**');
        expect(parte.trim(), licao.id).toBe(parte);
        expect(parte.length, licao.id).toBeGreaterThan(5);
      }
    }
  });

  it('o dia 3 sai com cada parte no lugar', () => {
    const dia3 = jornada.lessons.find((l) => l.day === 3);
    const passos = separarPassos(dia3?.body_md);

    expect(passos?.leitura).toBe('Salmo 91 (90)');
    expect(passos?.reflexao).toMatch(/^O salmo de quem mora/);
    expect(passos?.pratica).toMatch(/^Antes de dormir, reze o Salmo 91/);
    expect(passos?.intencao).toBe('Proteção para mim, para minha casa e para minha família.');
  });

  it('Presentes e pacotes não têm o formato: ficam numa tela só', () => {
    expect(produtos.lessons.length).toBeGreaterThan(0);
    for (const licao of produtos.lessons) {
      expect(separarPassos(licao.body_md), licao.id).toBeNull();
    }
  });
});

describe('separarPassos com corpo fora do formato', () => {
  const certo =
    '**Leitura do dia:** Salmo 91\n\nReflexão.\n\n**Prática de hoje:** Rezar.\n\n**Intenção:** Paz.';

  it('aceita o formato e a quebra de linha do Windows', () => {
    expect(separarPassos(certo)).toEqual({
      leitura: 'Salmo 91',
      reflexao: 'Reflexão.',
      pratica: 'Rezar.',
      intencao: 'Paz.',
    });
    expect(separarPassos(certo.replace(/\n/g, '\r\n'))?.reflexao).toBe('Reflexão.');
  });

  it.each([
    ['vazio', ''],
    ['sem a intenção', certo.replace('**Intenção:** Paz.', '')],
    ['fora de ordem', '**Leitura do dia:** X\n\nR.\n\n**Intenção:** Paz.\n\n**Prática de hoje:** Y.'],
    ['rótulo repetido', `${certo}\n\n**Intenção:** De novo.`],
    ['texto antes da leitura', `Abertura.\n\n${certo}`],
    ['sem reflexão', '**Leitura do dia:** X\n\n**Prática de hoje:** Y.\n\n**Intenção:** Z.'],
    ['rótulo diferente', certo.replace('Prática de hoje', 'Prática do dia')],
  ])('%s: null', (_nome, corpo) => {
    expect(separarPassos(corpo)).toBeNull();
  });

  it('aguenta null e undefined', () => {
    expect(separarPassos(null)).toBeNull();
    expect(separarPassos(undefined)).toBeNull();
  });
});

describe('passo da URL', () => {
  it.each([
    ['', 1],
    ['?passo=2', 2],
    ['?passo=3', 3],
    ['?passo=4', 1],
    ['?passo=0', 1],
    ['?passo=dois', 1],
    ['?passo=2.5', 1],
    ['?origem=push&passo=3', 3],
  ])('%s → %i', (busca, passo) => {
    expect(passoDaBusca(busca)).toBe(passo);
  });
});

describe('textos curtos', () => {
  it('quando o dia abre', () => {
    expect(textoDeLiberacao(1)).toBe('Libera amanhã');
    expect(textoDeLiberacao(5)).toBe('Libera em 5 dias');
    expect(textoDeLiberacao(undefined)).toBe('Libera em breve');
  });

  it('minutos arredondados para cima', () => {
    expect(minutosDe(401)).toBe(7);
    expect(minutosDe(420)).toBe(7);
    expect(minutosDe(0)).toBeNull();
    expect(minutosDe(null)).toBeNull();
  });
});
