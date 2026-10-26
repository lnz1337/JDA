import { describe, expect, it } from 'vitest';
import { ErroApi } from '../src/client/lib/erro-api';
import { descreverErro, semUrl } from '../src/client/lib/diagnostico';

/**
 * O relatório de falha do lembrete (CLAUDE.md §11).
 *
 * O que importa aqui é o `name` da exceção: no Safari do iPhone é ele que
 * distingue permissão recusada de assinatura recusada pelo serviço de push.
 */
describe('descreverErro', () => {
  it('usa nome e mensagem da exceção do aparelho', () => {
    const e = new Error('Registration failed - push service error');
    e.name = 'AbortError';
    expect(descreverErro(e)).toEqual({
      erro: 'AbortError: Registration failed - push service error',
    });
  });

  it('não depende de DOMException herdar de Error', () => {
    // Em WebKit antigo `new DOMException() instanceof Error` é falso, e um
    // `instanceof` aqui transformaria o erro mais informativo em "Desconhecido".
    const falso = { name: 'NotAllowedError', message: 'gesture required' };
    expect(descreverErro(falso)).toEqual({ erro: 'NotAllowedError: gesture required' });
  });

  it('erro da API leva o código e o status', () => {
    expect(descreverErro(new ErroApi('nao_autenticado', 401))).toEqual({
      erro: 'ErroApi: nao_autenticado',
      status: 401,
    });
  });

  it('o que não é erro nenhum ainda rende uma linha', () => {
    expect(descreverErro(null)).toEqual({ erro: 'Desconhecido: null' });
    expect(descreverErro('deu ruim')).toEqual({ erro: 'Desconhecido: deu ruim' });
  });

  it('nunca deixa passar o endpoint', () => {
    // O endpoint é credencial de entrega, não dado de relatório (§11), e
    // mensagem de erro de rede às vezes traz a URL inteira.
    const e = new Error('Failed to load https://web.push.apple.com/abc123SEGREDO');
    e.name = 'TypeError';
    const { erro } = descreverErro(e);
    expect(erro).not.toContain('web.push.apple.com');
    expect(erro).not.toContain('abc123SEGREDO');
    expect(erro).toBe('TypeError: Failed to load [url]');
  });

  it('corta mensagem muito longa', () => {
    const e = new Error('x'.repeat(500));
    e.name = 'InvalidStateError';
    expect(descreverErro(e).erro.length).toBeLessThanOrEqual('InvalidStateError: '.length + 200);
  });
});

describe('semUrl', () => {
  it('tira http, https e websocket', () => {
    expect(semUrl('a https://x.test/y b')).toBe('a [url] b');
    expect(semUrl('a http://x.test/y b')).toBe('a [url] b');
    expect(semUrl('a wss://x.test/y b')).toBe('a [url] b');
  });

  it('deixa texto sem URL intacto', () => {
    expect(semUrl('permission denied')).toBe('permission denied');
  });
});
