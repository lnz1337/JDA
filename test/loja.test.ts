import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ItemDaLoja, ProdutoDaLoja } from '../src/shared/types';
import app from '../src/worker/index';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

const BASE = 'https://exemplo.test';
const USER = 'u-loja';
const COOKIE = 'sessao=s-loja';

async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(
    `${BASE}${caminho}`,
    { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function criarUsuario(): Promise<void> {
  const agora = new Date().toISOString();
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(USER, 'pessoa@exemplo.com.br', 'Maria Souza', agora)
    .run();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind('s-loja', USER, new Date(Date.now() + 86_400_000).toISOString(), agora)
    .run();
}

async function conceder(produto: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
     VALUES (?, ?, ?, 'manual', 'active', ?)`,
  )
    .bind(`e-${produto}`, USER, produto, new Date().toISOString())
    .run();
}

/** Troca o checkout de um produto; `null` tira o botão de compra. */
async function comCheckout(produto: string, url: string | null = 'https://payt.site/abc123'): Promise<void> {
  await env.DB.prepare('UPDATE products SET checkout_url = ? WHERE id = ?').bind(url, produto).run();
}

async function listar(): Promise<ItemDaLoja[]> {
  const res = await chamar('/api/loja', { headers: { cookie: COOKIE } });
  const { itens } = (await res.json()) as { itens: ItemDaLoja[] };
  return itens;
}

async function abrirProduto(id: string): Promise<ProdutoDaLoja> {
  const res = await chamar(`/api/loja/${id}`, { headers: { cookie: COOKIE } });
  const { produto } = (await res.json()) as { produto: ProdutoDaLoja };
  return produto;
}

beforeEach(prepararBanco);

describe('GET /api/loja', () => {
  it('exige sessão', async () => {
    expect((await chamar('/api/loja')).status).toBe(401);
  });

  it('lista os dois bundles do funil, e só eles', async () => {
    await criarUsuario();
    const res = await chamar('/api/loja', { headers: { cookie: COOKIE } });
    expect(res.status).toBe(200);

    const { itens } = (await res.json()) as { itens: ItemDaLoja[] };
    expect(itens.map((i) => i.id)).toEqual(['oracao-sao-miguel', 'jornada-cura-padre-pio']);

    // O Círculo é da fase 7: oferecer o que ainda não existe confunde.
    expect(itens.some((i) => i.kind === 'subscription')).toBe(false);
    // A jornada de entrada tem listed = 0 no seed: ela não se vende na loja,
    // é o que a pessoa comprou para chegar aqui. O lugar dela é a aba Jornada.
    expect(itens.some((i) => i.id === 'jornada-meu-anjo')).toBe(false);
    // As partes dos bundles também não aparecem soltas na lista.
    expect(itens.some((i) => i.id === 'manual-purificacao')).toBe(false);
  });

  it('bundle mostra o que vem dentro', async () => {
    await criarUsuario();
    const up1 = (await listar()).find((i) => i.id === 'oracao-sao-miguel');

    expect(up1?.inclui).toHaveLength(3);
    expect(up1?.inclui).toContain('Manual de Purificação e Autocuidado');
  });

  it('sem entitlement: sem acesso, com preço e sem para onde abrir', async () => {
    await criarUsuario();
    const up1 = (await listar()).find((i) => i.id === 'oracao-sao-miguel');

    expect(up1?.tem_acesso).toBe(false);
    expect(up1?.preco_cents).toBe(19700);
    expect(up1?.abrir).toBeNull();
  });

  it('produto sem checkout_url não é comprável', async () => {
    await criarUsuario();
    // Link ainda não cadastrado é estado normal de um produto novo no catálogo.
    await comCheckout('oracao-sao-miguel', null);
    expect((await listar()).find((i) => i.id === 'oracao-sao-miguel')?.tem_checkout).toBe(false);

    await comCheckout('oracao-sao-miguel');
    expect((await listar()).find((i) => i.id === 'oracao-sao-miguel')?.tem_checkout).toBe(true);
  });

  it('bundle com várias partes, Abrir vai para a página do produto', async () => {
    await criarUsuario();
    await conceder('jornada-cura-padre-pio');

    const up2 = (await listar()).find((i) => i.id === 'jornada-cura-padre-pio');
    expect(up2?.tem_acesso).toBe(true);
    expect(up2?.abrir).toBe('/produto/jornada-cura-padre-pio');
  });

  it('acesso pelo bundle libera a parte, mesmo sem entitlement dela', async () => {
    await criarUsuario();
    await conceder('oracao-sao-miguel');

    // A regra é a do hasAccess (§6); a loja não reimplementa acesso.
    const parte = await abrirProduto('manual-purificacao');
    expect(parte.tem_acesso).toBe(true);
  });

  it('com um programa só, Abrir vai direto para o programa', async () => {
    await criarUsuario();
    await conceder('oracao-sao-miguel');

    // Um toque a mais para chegar na oração é um toque a mais para desistir.
    const parte = await abrirProduto('manual-purificacao');
    expect(parte.abrir).toBe('/programa/manual-purificacao');
  });
});

describe('GET /api/loja/:id', () => {
  it('exige sessão', async () => {
    expect((await chamar('/api/loja/oracao-sao-miguel')).status).toBe(401);
  });

  it('traz descrição, partes e os títulos das lições', async () => {
    await criarUsuario();
    const produto = await abrirProduto('jornada-cura-padre-pio');

    expect(produto.descricao_md).toContain('Jornada de Cura');
    expect(produto.partes.map((p) => p.id)).toEqual(['jornada-cura', 'limpeza-anjos']);

    const cura = produto.partes[0];
    expect(cura?.licoes).toHaveLength(7);
    expect(cura?.licoes[0]).toBe('Dia 1: Quem foi Padre Pio');
  });

  it('nunca manda o conteúdo da lição, só o título', async () => {
    await criarUsuario();
    const res = await chamar('/api/loja/jornada-cura-padre-pio', { headers: { cookie: COOKIE } });
    const texto = await res.text();

    // A prévia é da loja: corpo de lição aqui seria conteúdo pago entregue de graça.
    expect(texto).not.toContain('body_md');
    expect(texto).not.toContain('audio_key');
    expect(texto).not.toContain('Padre Pio nasceu');
  });

  it('o aviso obrigatório das partes aparece no bundle (§14)', async () => {
    await criarUsuario();
    const produto = await abrirProduto('jornada-cura-padre-pio');

    // O bundle não tem notice próprio; quem tem é a Jornada de Cura, dentro dele.
    expect(produto.avisos).toContain(
      'Conteúdo devocional. Não substitui acompanhamento médico nem tratamento.',
    );
  });

  it('não repete o mesmo aviso duas vezes', async () => {
    await criarUsuario();
    const produto = await abrirProduto('oracao-sao-miguel');

    // Manual de Purificação e Mapa da Prosperidade têm avisos diferentes.
    expect(produto.avisos).toHaveLength(new Set(produto.avisos).size);
    expect(produto.avisos.length).toBeGreaterThanOrEqual(2);
  });

  it('produto que não existe é 404', async () => {
    await criarUsuario();
    expect((await chamar('/api/loja/nao-existe', { headers: { cookie: COOKIE } })).status).toBe(404);
  });

  it('assinatura ainda não tem página de loja', async () => {
    await criarUsuario();
    expect((await chamar('/api/loja/circulo-mensal', { headers: { cookie: COOKIE } })).status).toBe(
      404,
    );
  });

  it('o e-mail da conta vem na resposta, para o aviso antes do botão', async () => {
    await criarUsuario();
    const produto = await abrirProduto('oracao-sao-miguel');

    // Compra com outro e-mail cria outra conta pelo postback, e o conteúdo não
    // aparece para quem comprou.
    expect(produto.email_da_conta).toBe('pessoa@exemplo.com.br');
  });

  it('o link de checkout leva as UTMs da loja (§7)', async () => {
    await criarUsuario();
    await comCheckout('oracao-sao-miguel', 'https://payt.site/abc123');

    const produto = await abrirProduto('oracao-sao-miguel');
    const url = new URL(produto.checkout_url ?? '');
    expect(url.searchParams.get('utm_source')).toBe('app');
    expect(url.searchParams.get('utm_medium')).toBe('loja');
    expect(url.searchParams.get('utm_campaign')).toBe('oracao-sao-miguel');
  });

  it('checkout que já tem query não perde o que tinha', async () => {
    await criarUsuario();
    await comCheckout('oracao-sao-miguel', 'https://payt.site/abc123?off=xyz');

    const produto = await abrirProduto('oracao-sao-miguel');
    const url = new URL(produto.checkout_url ?? '');
    expect(url.searchParams.get('off')).toBe('xyz');
    expect(url.searchParams.get('utm_source')).toBe('app');
  });

  it('sem checkout_url, não há link nenhum', async () => {
    await criarUsuario();
    await comCheckout('oracao-sao-miguel', null);
    const produto = await abrirProduto('oracao-sao-miguel');
    expect(produto.checkout_url).toBeNull();
  });
});
