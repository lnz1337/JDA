import { describe, expect, it } from 'vitest';
import { montarAnuncio } from '../src/worker/emails/anuncio';
import { renderizarEmail } from '../src/worker/emails/render';

/** Qualquer tag HTML. A versão text/plain não pode ter nenhuma. */
const TAG = /<[a-z/][^>]*>/i;

const MODELO = `Assunto: Oi {{nome}}

Olá{{nome}}!

Seu código é:

:destaque: {{codigo}}

[ Entrar no meu app ](https://exemplo.test/acesso?t=abc)

Equipe`;

describe('render de e-mail', () => {
  it('monta um documento HTML completo, em pt-BR', () => {
    const { html } = renderizarEmail(MODELO, { nome: ', Maria', codigo: '123456' });

    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('<html lang="pt-BR"');
    expect(html.toLowerCase()).toContain('<meta charset="utf-8">');
    expect(html).toContain('<body');
    expect(html).toContain('</html>');
  });

  it('a versão em texto não tem nenhuma tag HTML', () => {
    const { texto } = renderizarEmail(MODELO, { nome: '', codigo: '123456' });
    expect(texto).not.toMatch(TAG);
  });

  it('tag crua no modelo não vaza para o texto', () => {
    // Era o bug: o <small> do rodapé saía literal na versão de texto.
    const { texto, html } = renderizarEmail(
      'Assunto: a\n\nOlá\n\n<small>Precisa de ajuda? Escreva para nós.</small>',
    );
    expect(texto).not.toMatch(TAG);
    expect(texto).toContain('Precisa de ajuda?');
    expect(html).toContain('Precisa de ajuda?');
  });

  it('letra grande: o corpo não sai abaixo de 18px', () => {
    const { html } = renderizarEmail(MODELO, { nome: '', codigo: '123456' });
    const tamanhos = [...html.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));

    expect(tamanhos.length).toBeGreaterThan(0);
    // O rodapé pode ser menor, mas nada no corpo pode ficar miúdo.
    expect(Math.max(...tamanhos)).toBeGreaterThanOrEqual(18);
    expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(15);
  });

  it(':destaque: vira bloco grande no HTML e só o conteúdo no texto', () => {
    const { html, texto } = renderizarEmail(MODELO, { nome: '', codigo: '123456' });

    const destaque = /font-size:\s*(\d+)px[^"]*"[^>]*>\s*123456/.exec(html);
    expect(destaque, 'o código precisa de um bloco próprio').toBeTruthy();
    expect(Number(destaque?.[1])).toBeGreaterThanOrEqual(32);

    expect(texto).toContain('123456');
    expect(texto).not.toContain(':destaque:');
  });

  it('link sozinho na linha vira botão; link no meio do texto continua link', () => {
    const { html } = renderizarEmail(
      'Assunto: a\n\n[ Entrar ](https://exemplo.test/x)\n\nou [clique aqui](https://exemplo.test/y) para sair.',
    );

    const botao = /<a[^>]+href="https:\/\/exemplo\.test\/x"[^>]*>/.exec(html);
    expect(botao?.[0]).toContain('display:inline-block');
    expect(botao?.[0]).toContain('padding');

    const link = /<a[^>]+href="https:\/\/exemplo\.test\/y"[^>]*>/.exec(html);
    expect(link?.[0]).not.toContain('display:inline-block');
  });

  it('o texto do botão não leva os espaços dos colchetes', () => {
    const { html, texto } = renderizarEmail('Assunto: a\n\n[ Entrar ](https://exemplo.test/x)');
    expect(html).toContain('>Entrar<');
    expect(texto).toContain('Entrar: https://exemplo.test/x');
  });

  it('o rodapé é o nome do app e o motivo, sem dado de empresa', () => {
    const { html, texto } = renderizarEmail('Assunto: a\n\nOlá', {}, {
      motivo: 'Você recebeu este e-mail porque pediu um código de acesso.',
    });

    for (const saida of [html, texto]) {
      expect(saida).toContain('Jornada com Meu Anjo');
      expect(saida).toContain('porque pediu um código de acesso');
      expect(saida).not.toMatch(/CNPJ|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    }
  });

  it('sem rodapé declarado, não inventa um', () => {
    const { html } = renderizarEmail('Assunto: a\n\nOlá');
    expect(html).not.toContain('Você recebeu este e-mail');
  });
});

describe('anúncio da campanha', () => {
  const variaveis = {
    primeiro_nome: 'Maria',
    link_acesso: 'https://exemplo.test/acesso?t=tok',
    lista_produtos: '- Jornada com Meu Anjo',
    link_parar: 'https://exemplo.test/parar?u=1&t=2',
    email_suporte: 'suporte@jornadacomeuanjo.com',
  };

  it('descarta o rodapé do arquivo de conteúdo e usa o nosso', () => {
    const { html, texto } = montarAnuncio(variaveis);

    for (const saida of [html, texto]) {
      expect(saida).not.toMatch(/CNPJ|Nexstage|L V Marketing/);
    }

    // O link de parar de receber é obrigatório (§14) e continua lá — escapado
    // no HTML, cru no texto.
    expect(texto).toContain(variaveis.link_parar);
    expect(html).toContain('href="https://exemplo.test/parar?u=1&amp;t=2"');
  });

  it('leva o link de acesso direto', () => {
    expect(montarAnuncio(variaveis).html).toContain(variaveis.link_acesso);
  });

  it('o rodapé aparece uma vez só', () => {
    const { html, texto } = montarAnuncio(variaveis);

    // O arquivo de conteúdo tem rodapé próprio e o renderizador põe o dele: se
    // os dois saírem, a pessoa recebe duas vezes o "parar de receber".
    expect(texto.split(variaveis.link_parar)).toHaveLength(2);
    expect(html.split('href="https://exemplo.test/parar?u=1&amp;t=2"')).toHaveLength(2);
    expect(texto.match(/está recebendo este e-mail|recebeu este e-mail/g)).toHaveLength(1);
  });

  it('comentário de HTML no conteúdo não vira texto do e-mail', () => {
    const { html, texto } = montarAnuncio(variaveis);

    // O arquivo tem uma nota editorial em <!-- -->: é recado para quem escreve.
    for (const saida of [html, texto]) {
      expect(saida).not.toContain('Nota editorial');
      expect(saida).not.toContain('<!--');
    }
  });

  it('sem nome, a saudação e o assunto não ficam com vírgula solta', () => {
    const { texto, assunto } = montarAnuncio({ ...variaveis, primeiro_nome: '' });
    expect(texto).not.toMatch(/Olá,\s*!/);
    expect(texto.startsWith('Olá!')).toBe(true);
    expect(assunto).toBe('Sua Jornada com Meu Anjo agora tem um app');
  });

  it('com nome, o assunto começa pelo nome', () => {
    expect(montarAnuncio(variaveis).assunto).toBe(
      'Maria, sua Jornada com Meu Anjo agora tem um app',
    );
  });

  it('a versão em texto não tem tag nenhuma', () => {
    expect(montarAnuncio(variaveis).texto).not.toMatch(TAG);
  });
});

describe('anúncio da campanha, modelo curto', () => {
  const variaveis = {
    primeiro_nome: 'Maria',
    link_acesso: 'https://exemplo.test/acesso?t=tok',
    lista_produtos: '- Jornada com Meu Anjo',
    link_parar: 'https://exemplo.test/parar?u=1&t=2',
    email_suporte: 'suporte@jornadacomeuanjo.com',
  };
  // Estilo que só o botão tem (emails/layout.ts).
  const BOTAO = 'padding:18px 32px';

  it('lê o arquivo curto, com o assunto dele', () => {
    expect(montarAnuncio(variaveis, 'curto').assunto).toBe(
      'Maria, seu acesso ao app da Jornada está liberado',
    );
  });

  it('o link de acesso fica dentro da frase, sem virar botão', () => {
    const { html, texto } = montarAnuncio(variaveis, 'curto');
    expect(html).toContain('href="https://exemplo.test/acesso?t=tok"');
    expect(html).not.toContain(BOTAO);
    expect(texto).toContain('toque aqui e o app abre já com o seu acesso');
    // O completo continua com o botão: a diferença é do modelo, não do renderizador.
    expect(montarAnuncio(variaveis).html).toContain(BOTAO);
  });

  it('leva os produtos e o rodapé uma vez só', () => {
    const { html, texto } = montarAnuncio(variaveis, 'curto');
    expect(texto).toContain('Jornada com Meu Anjo');
    expect(texto.split(variaveis.link_parar)).toHaveLength(2);
    expect(html.split('href="https://exemplo.test/parar?u=1&amp;t=2"')).toHaveLength(2);
  });

  it('sem nome, a saudação e o assunto não ficam com vírgula solta', () => {
    const { texto, assunto } = montarAnuncio({ ...variaveis, primeiro_nome: '' }, 'curto');
    expect(texto.startsWith('Olá!')).toBe(true);
    expect(assunto).toBe('Seu acesso ao app da Jornada está liberado');
  });

  it('a versão em texto não tem tag nenhuma', () => {
    expect(montarAnuncio(variaveis, 'curto').texto).not.toMatch(TAG);
  });
});
