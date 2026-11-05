import { describe, expect, it } from 'vitest';
import {
  abaPodeRecarregar,
  deveProcurarVersao,
  podeRecarregarAgora,
  PROCURAR_VERSAO_MS,
} from '../../src/shared/atualizacao.ts';

describe('aba que o service worker recarrega sozinho', () => {
  it('fora da lição recarrega: não há oração tocando', () => {
    for (const caminho of ['/', '/entrar', '/loja', '/programa/jornada', '/produto/x', '/instalar']) {
      expect(abaPodeRecarregar(caminho)).toBe(true);
    }
  });

  it('na lição não recarrega: o áudio pode estar tocando', () => {
    expect(abaPodeRecarregar('/licao/jornada-d03')).toBe(false);
    expect(abaPodeRecarregar('/licao/jornada-d03/')).toBe(false);
  });
});

describe('quando a página recarrega depois do service worker novo assumir', () => {
  it('fora da lição, na hora', () => {
    expect(podeRecarregarAgora({ caminho: '/entrar', audioTocando: false, visivel: true })).toBe(true);
    expect(podeRecarregarAgora({ caminho: '/', audioTocando: false, visivel: true })).toBe(true);
  });

  it('com áudio tocando, nunca: nem com a tela apagada, que é quando se reza ouvindo', () => {
    expect(podeRecarregarAgora({ caminho: '/licao/x', audioTocando: true, visivel: true })).toBe(false);
    expect(podeRecarregarAgora({ caminho: '/licao/x', audioTocando: true, visivel: false })).toBe(false);
  });

  it('na lição parada e à vista, espera: a pessoa pode estar lendo a reflexão', () => {
    expect(podeRecarregarAgora({ caminho: '/licao/x', audioTocando: false, visivel: true })).toBe(false);
  });

  it('na lição parada e escondida, recarrega: ninguém vê', () => {
    expect(podeRecarregarAgora({ caminho: '/licao/x', audioTocando: false, visivel: false })).toBe(true);
  });
});

describe('procurar versão nova ao voltar para o app', () => {
  it('na primeira vez procura', () => {
    expect(deveProcurarVersao(null, 1_000)).toBe(true);
  });

  it('não procura de novo antes do intervalo', () => {
    expect(deveProcurarVersao(1_000, 1_000 + PROCURAR_VERSAO_MS - 1)).toBe(false);
    expect(deveProcurarVersao(1_000, 1_000 + PROCURAR_VERSAO_MS)).toBe(true);
  });
});
