import { describe, expect, it } from 'vitest';
import { formasDoSku } from '../../src/worker/lib/payt-sku.ts';

describe('formasDoSku', () => {
  it('postback: o sku sozinho', () => {
    expect(formasDoSku('853b4781f48478')).toEqual(['853b4781f48478']);
  });

  it('relatório: o inteiro e o pedaço depois do hífen', () => {
    expect(formasDoSku('6a44473d38700-853b4781f48478')).toEqual([
      '6a44473d38700-853b4781f48478',
      '853b4781f48478',
    ]);
  });

  it('vazio não procura nada', () => {
    expect(formasDoSku('')).toEqual([]);
    expect(formasDoSku(null)).toEqual([]);
    expect(formasDoSku('  ')).toEqual([]);
  });

  it('hífen no fim não gera forma vazia', () => {
    expect(formasDoSku('abc-')).toEqual(['abc-']);
  });
});
