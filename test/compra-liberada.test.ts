import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import pedidoPago from '../fixtures/payt/pedido-pago.json';
import app from '../src/worker/index';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

/**
 * A volta da compra (fase 6, §7).
 *
 * A tela promete "avisamos quando liberar" para quem pagou com Pix ou boleto.
 * Quem já tinha conta não recebia nada: o e-mail de boas-vindas é só de quem
 * acabou de nascer no banco. Estes testes são a promessa.
 */
const BASE = 'https://exemplo.test';
const USER = 'u-compra';
const COOKIE = 'sessao=s-compra';
const EMAIL = 'cliente.exemplo@exemplo.com.br';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/aparelho-compra';
const P256DH =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

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

async function postarPostback(payload: unknown): Promise<void> {
  const ctx = createExecutionContext();
  await app.request(
    `${BASE}/api/payt/postback`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(payload as object), integration_key: envTeste.PAYT_INTEGRATION_KEY }),
    },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

async function criarUsuario(email = EMAIL): Promise<void> {
  const agora = new Date().toISOString();
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(USER, email, 'Maria Souza', agora)
    .run();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind('s-compra', USER, new Date(Date.now() + 86_400_000).toISOString(), agora)
    .run();
}

/** O código da fixture apontando para um produto nosso, como no staging. */
async function mapearFixture(produto = 'oracao-sao-miguel'): Promise<void> {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO product_payt_map (payt_code, product_id) VALUES (?, ?)',
  )
    .bind('LJ7KEP', produto)
    .run();
}

async function comPush(): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind('sub-compra', USER, ENDPOINT, P256DH, AUTH, new Date().toISOString())
    .run();
}

async function nomesDeEventos(prefixo: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT name FROM events WHERE name LIKE ? ORDER BY created_at',
  )
    .bind(`${prefixo}%`)
    .all<{ name: string }>();
  return results.map((l) => l.name);
}

beforeEach(prepararBanco);

describe('GET /api/me/entitlements', () => {
  it('exige sessão', async () => {
    expect((await chamar('/api/me/entitlements')).status).toBe(401);
  });

  it('sem compra, lista vazia', async () => {
    await criarUsuario();
    const res = await chamar('/api/me/entitlements', { headers: { cookie: COOKIE } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ produtos: [] });
  });

  it('quem comprou o pacote vê o pacote e as partes', async () => {
    await criarUsuario();
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
       VALUES ('e-1', ?, 'oracao-sao-miguel', 'manual', 'active', ?)`,
    )
      .bind(USER, new Date().toISOString())
      .run();

    const res = await chamar('/api/me/entitlements', { headers: { cookie: COOKIE } });
    const { produtos } = (await res.json()) as { produtos: string[] };

    expect(produtos).toContain('oracao-sao-miguel');
    // Quem compra o pacote espera ver as partes liberadas.
    expect(produtos).toContain('manual-purificacao');
    expect(produtos).toContain('oracao-gargano');
  });

  it('entitlement revogado não conta', async () => {
    await criarUsuario();
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at, revoked_at)
       VALUES ('e-1', ?, 'oracao-sao-miguel', 'manual', 'revoked', ?, ?)`,
    )
      .bind(USER, new Date().toISOString(), new Date().toISOString())
      .run();

    const { produtos } = (await (
      await chamar('/api/me/entitlements', { headers: { cookie: COOKIE } })
    ).json()) as { produtos: string[] };
    expect(produtos).toEqual([]);
  });
});

describe('aviso de conteúdo liberado', () => {
  // O envio de push passa por fetch; cada teste põe o seu e devolve no finally.
  const originalFetch = globalThis.fetch;

  it('cliente que já existia recebe push e e-mail', async () => {
    await criarUsuario();
    await comPush();
    await mapearFixture();

    globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
    try {
      await postarPostback(pedidoPago);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(await nomesDeEventos('push_')).toContain('push_enviado');
    expect(await nomesDeEventos('email_')).toContain('email_enviado');

    const evento = await env.DB.prepare(
      "SELECT props_json FROM events WHERE name = 'push_enviado'",
    ).first<{ props_json: string }>();
    expect(JSON.parse(evento?.props_json ?? '{}')).toMatchObject({ tipo: 'conteudo_liberado' });
  });

  it('o push nomeia o produto e não leva o endpoint', async () => {
    await criarUsuario();
    await comPush();
    await mapearFixture();

    let corpoEnviado = '';
    globalThis.fetch = (async (url: unknown) => {
      corpoEnviado = String(url);
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    try {
      await postarPostback(pedidoPago);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // O corpo vai cifrado; o que dá para conferir aqui é que saiu para o
    // serviço certo e que o evento não guardou o endpoint (§11).
    expect(corpoEnviado).toContain('fcm.googleapis.com');
    const evento = await env.DB.prepare(
      "SELECT props_json FROM events WHERE name = 'push_enviado'",
    ).first<{ props_json: string }>();
    expect(evento?.props_json).not.toContain('aparelho-compra');
  });

  it('cliente novo recebe boas-vindas, não o aviso de liberado', async () => {
    await mapearFixture();

    globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
    try {
      await postarPostback(pedidoPago);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Dizer "bem-vindo" e "seu conteúdo liberou" na mesma compra é dois e-mails
    // para a mesma notícia.
    const { results } = await env.DB.prepare(
      "SELECT props_json FROM events WHERE name = 'email_enviado'",
    ).all<{ props_json: string }>();
    const tipos = results.map((l) => JSON.parse(l.props_json).tipo);
    expect(tipos).toContain('boas_vindas');
    expect(tipos).not.toContain('conteudo_liberado');
  });

  it('sem assinatura de push, o e-mail sai do mesmo jeito', async () => {
    await criarUsuario();
    await mapearFixture();

    globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
    try {
      await postarPostback(pedidoPago);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Quem comprou no computador não tem push neste celular.
    expect(await nomesDeEventos('email_')).toContain('email_enviado');
    expect(await nomesDeEventos('push_')).toEqual([]);
  });

  it('o acesso é concedido mesmo assim', async () => {
    await criarUsuario();
    await mapearFixture();

    globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
    try {
      await postarPostback(pedidoPago);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const { produtos } = (await (
      await chamar('/api/me/entitlements', { headers: { cookie: COOKIE } })
    ).json()) as { produtos: string[] };
    expect(produtos).toContain('oracao-sao-miguel');
  });
});
