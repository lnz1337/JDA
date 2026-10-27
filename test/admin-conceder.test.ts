import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

/**
 * Concessão manual do suporte (CLAUDE.md §13). Criar a conta e mandar o link
 * são opt-in: e-mail que não existe, para o suporte, costuma ser digitação
 * errada, e criar sem pedir faria uma conta nova em vez de achar a certa.
 */
const EMAIL = 'cliente.exemplo@exemplo.com.br';

async function conceder(corpo: Record<string, unknown>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(
    'https://exemplo.test/api/admin/conceder',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': envTeste.ADMIN_API_KEY ?? '' },
      body: JSON.stringify(corpo),
    },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function contas(): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?')
    .bind(EMAIL)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

beforeEach(prepararBanco);

describe('POST /api/admin/conceder', () => {
  it('e-mail desconhecido sem --criar continua 404', async () => {
    const res = await conceder({ email: EMAIL, product_id: 'jornada-meu-anjo' });
    expect(res.status).toBe(404);
    expect(await contas()).toBe(0);
  });

  it('com criar_usuario, cria a conta e concede', async () => {
    const res = await conceder({
      email: EMAIL.toUpperCase(),
      product_id: 'jornada-meu-anjo',
      criar_usuario: true,
      nome: 'Maria Souza',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, usuario_criado: true, status: 'active' });
    // E-mail guardado em minúsculas, como no resto do app.
    expect(await contas()).toBe(1);
  });

  it('produto errado não deixa conta criada para trás', async () => {
    const res = await conceder({ email: EMAIL, product_id: 'nao-existe', criar_usuario: true });
    expect(res.status).toBe(404);
    expect(await contas()).toBe(0);
  });

  it('conta existente não é criada de novo', async () => {
    await conceder({ email: EMAIL, product_id: 'jornada-meu-anjo', criar_usuario: true });
    const res = await conceder({ email: EMAIL, product_id: 'oracao-sao-miguel', criar_usuario: true });
    expect(await res.json()).toMatchObject({ usuario_criado: false });
    expect(await contas()).toBe(1);
  });

  it('enviar_acesso manda as boas-vindas com link de acesso', async () => {
    const res = await conceder({
      email: EMAIL,
      product_id: 'jornada-meu-anjo',
      criar_usuario: true,
      enviar_acesso: true,
    });
    expect(await res.json()).toMatchObject({ email_enviado: true });

    const evento = await env.DB.prepare(
      "SELECT props_json FROM events WHERE name = 'email_enviado'",
    ).first<{ props_json: string }>();
    expect(JSON.parse(evento?.props_json ?? '{}')).toMatchObject({ tipo: 'boas_vindas' });

    const links = await env.DB.prepare('SELECT COUNT(*) AS n FROM access_links').first<{ n: number }>();
    expect(links?.n).toBe(1);
  });

  it('sem enviar_acesso, nenhum e-mail sai', async () => {
    await conceder({ email: EMAIL, product_id: 'jornada-meu-anjo', criar_usuario: true });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE name LIKE 'email_%'").first<{
      n: number;
    }>();
    expect(n?.n).toBe(0);
  });
});
