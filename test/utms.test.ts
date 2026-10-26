import { describe, expect, it } from 'vitest';
import { utmsDo } from '../src/worker/services/payt';

/**
 * As UTMs que voltam no postback (§7).
 *
 * O botão da loja monta `utm_source=app&utm_medium=loja&utm_campaign={produto}`.
 * **O formato de volta ainda não foi visto**: no único postback real que temos,
 * `link.query_params` e `link.sources` vêm vazios, porque aquela compra foi
 * feita direto no link da Payt. Por isso a leitura aceita as formas plausíveis
 * em vez de apostar numa — e, acima de tudo, nunca explode.
 */
describe('utmsDo', () => {
  const esperado = { utm_source: 'app', utm_medium: 'loja', utm_campaign: 'oracao-sao-miguel' };

  it('lista de pares name/value', () => {
    expect(
      utmsDo({
        query_params: [
          { name: 'utm_source', value: 'app' },
          { name: 'utm_medium', value: 'loja' },
          { name: 'utm_campaign', value: 'oracao-sao-miguel' },
        ],
      }),
    ).toEqual(esperado);
  });

  it('lista de pares key/value', () => {
    expect(
      utmsDo({
        query_params: [
          { key: 'utm_source', value: 'app' },
          { key: 'utm_medium', value: 'loja' },
          { key: 'utm_campaign', value: 'oracao-sao-miguel' },
        ],
      }),
    ).toEqual(esperado);
  });

  it('objeto simples', () => {
    expect(utmsDo({ query_params: esperado })).toEqual(esperado);
  });

  it('lista de "chave=valor"', () => {
    expect(
      utmsDo({
        query_params: ['utm_source=app', 'utm_medium=loja', 'utm_campaign=oracao-sao-miguel'],
      }),
    ).toEqual(esperado);
  });

  it('também olha o sources', () => {
    expect(utmsDo({ sources: { utm_source: 'app' } })).toEqual({ utm_source: 'app' });
  });

  it('o postback real de hoje não tem UTM nenhuma', () => {
    // sources e query_params vazios: foi exatamente o que a Payt mandou.
    expect(utmsDo({ title: 'x', sources: [], url: 'https://payt.site/abc', query_params: [] })).toEqual(
      {},
    );
  });

  it('só devolve chave utm_', () => {
    // Link de oferta traz parâmetro próprio; ele não é dado de funil.
    expect(utmsDo({ query_params: { off: 'xyz', utm_source: 'app' } })).toEqual({
      utm_source: 'app',
    });
  });

  it('formato que não bate devolve vazio em vez de explodir', () => {
    // O processamento do postback é o que concede o acesso: ele não pode cair
    // por causa de um campo de relatório.
    for (const entrada of [null, undefined, 'texto', 42, [], {}, { query_params: 7 }]) {
      expect(utmsDo(entrada)).toEqual({});
    }
    expect(utmsDo({ query_params: [null, 1, { name: 'utm_source' }] })).toEqual({});
  });
});
