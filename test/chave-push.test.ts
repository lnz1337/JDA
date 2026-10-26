import { describe, expect, it } from 'vitest';
import { chaveParaBytes } from '../src/client/lib/chave';

/**
 * A chave pública VAPID virando bytes para o `subscribe`.
 *
 * O `atob` do navegador é estrito: BOM, espaço ou quebra de linha na chave
 * derrubam o `subscribe` com `InvalidCharacterError`, que não diz de onde veio.
 * Foi o que aconteceu no iPhone em 26/10, com um BOM dentro do segredo.
 */
describe('chaveParaBytes', () => {
  /** Chave P-256 de verdade, 65 bytes, começando com 0x04. */
  const CHAVE =
    'BJkELrNZ_z_apnVQsk6voQ9w0YaGmDSciNAnt2neucyS-mYPUGtcydve0Frowdq6Ur-_l_tQzB1avIC6uKt8x08';

  it('decodifica para 65 bytes começando em 0x04', () => {
    const bytes = chaveParaBytes(CHAVE);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('aguenta BOM, espaço e quebra de linha', () => {
    for (const sujeira of ['﻿', ' ', '\n', '\r\n', '\t']) {
      const bytes = chaveParaBytes(`${sujeira}${CHAVE}${sujeira}`);
      expect(bytes.length).toBe(65);
      expect(bytes[0]).toBe(0x04);
    }
  });

  it('o padding sai do tamanho real, não do tamanho com sujeira', () => {
    // O BOM fazia a chave medir 88 em vez de 87, e com 88 o padEnd não
    // acrescentava o '=' que falta: o erro mudava de lugar, não sumia.
    expect(chaveParaBytes(`﻿${CHAVE}`)).toEqual(chaveParaBytes(CHAVE));
  });

  it('recusa chave fora do alfabeto base64url, dizendo o que é', () => {
    // `InvalidCharacterError: The string contains invalid characters` não aponta
    // para a chave. Esta mensagem aponta.
    expect(() => chaveParaBytes('não é base64!')).toThrow(/chave/i);
  });

  it('recusa chave vazia', () => {
    expect(() => chaveParaBytes('')).toThrow(/chave/i);
    expect(() => chaveParaBytes('﻿')).toThrow(/chave/i);
  });
});
