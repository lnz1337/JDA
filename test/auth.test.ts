import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { LINK_ACESSO_DIAS, SESSAO_DIAS } from '../src/shared/constants';
import app from '../src/worker/index';
import { criarLinkDeAcesso, pedirCodigoDeAcao } from '../src/worker/services/auth';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

const BASE = 'https://exemplo.test';
const EMAIL = 'pessoa@exemplo.com.br';

async function chamar(
  caminho: string,
  init: RequestInit & { ip?: string } = {},
  ambiente: Record<string, unknown> = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const { ip, ...resto } = init;
  const res = await app.request(
    `${BASE}${caminho}`,
    {
      ...resto,
      headers: {
        'content-type': 'application/json',
        ...(ip ? { 'cf-connecting-ip': ip } : {}),
        ...(resto.headers ?? {}),
      },
    },
    { ...envTeste, ...ambiente },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function criarUsuario(email = EMAIL, nome = 'Maria Souza'): Promise<string> {
  const id = `u-${email}`;
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, nome, new Date().toISOString())
    .run();
  return id;
}

/**
 * O código real só existe com hash e nunca sai do servidor — então o teste
 * substitui o hash do último código por um conhecido, em vez de adivinhar o que
 * foi sorteado. O que está sob teste é a conferência, não o sorteio.
 */
async function fixarCodigo(userId: string, codigo = '123456'): Promise<string> {
  const { sha256Hex } = await import('../src/worker/lib/cripto');
  await env.DB.prepare(
    `UPDATE login_codes SET code_hash = ?
      WHERE id = (SELECT id FROM login_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1)`,
  )
    .bind(await sha256Hex(`${codigo}|${userId}`), userId)
    .run();
  return codigo;
}

function cookieDa(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

beforeEach(prepararBanco);

describe('pedir código', () => {
  it('responde igual para e-mail que existe e que não existe', async () => {
    await criarUsuario();

    const existe = await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL }),
    });
    const naoExiste = await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: 'ninguem@exemplo.com.br' }),
    });

    expect(existe.status).toBe(naoExiste.status);
    expect(await existe.json()).toEqual(await naoExiste.json());
  });

  it('só cria código para quem existe', async () => {
    const id = await criarUsuario();

    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: 'ninguem@exemplo.com.br' }),
    });

    const { results } = await env.DB.prepare('SELECT user_id FROM login_codes').all<{
      user_id: string;
    }>();
    expect(results.map((r) => r.user_id)).toEqual([id]);
  });

  it('guarda o código com hash, nunca em claro', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });

    const codigo = await fixarCodigo(id);
    const linha = await env.DB.prepare('SELECT code_hash FROM login_codes WHERE user_id = ?')
      .bind(id)
      .first<{ code_hash: string }>();

    expect(linha?.code_hash).not.toContain(codigo);
    expect(linha?.code_hash).toHaveLength(64); // sha256 em hex
  });

  it('recusa e-mail malformado', async () => {
    const res = await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: 'nao-e-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('limita a 5 pedidos por hora para o mesmo e-mail', async () => {
    const id = await criarUsuario();

    for (let i = 0; i < 7; i += 1) {
      await chamar('/api/auth/codigo', {
        method: 'POST',
        body: JSON.stringify({ email: EMAIL }),
        ip: `10.0.0.${i}`, // IP diferente a cada vez: o limite testado é o do e-mail
      });
    }

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE user_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(r?.n).toBe(5);
  });

  it('limita a 5 pedidos por hora para o mesmo IP', async () => {
    for (let i = 0; i < 7; i += 1) {
      await criarUsuario(`p${i}@exemplo.com.br`, 'Pessoa');
      await chamar('/api/auth/codigo', {
        method: 'POST',
        body: JSON.stringify({ email: `p${i}@exemplo.com.br` }),
        ip: '203.0.113.9',
      });
    }

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes').first<{ n: number }>();
    expect(r?.n).toBe(5);
  });

  it('registra o envio em events, sem o código', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });

    const codigo = await fixarCodigo(id);
    const linha = await env.DB.prepare(
      "SELECT name, props_json FROM events WHERE name LIKE 'email_%'",
    ).first<{ name: string; props_json: string }>();

    expect(linha?.name).toMatch(/^email_(enviado|falhou)$/);
    expect(JSON.parse(linha?.props_json ?? '{}')).toMatchObject({ tipo: 'codigo_login' });
    expect(linha?.props_json).not.toContain(codigo);
  });
});

describe('entrar', () => {
  it('entra com o código e abre sessão', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);

    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');

    const sessoes = await env.DB.prepare('SELECT user_id FROM sessions').first<{
      user_id: string;
    }>();
    expect(sessoes?.user_id).toBe(id);
  });

  it('marca o código como usado', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);

    await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });
    const segunda = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });

    expect(segunda.status).toBe(401);
  });

  it('conta tentativa errada e trava na sexta', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);

    for (let i = 0; i < 5; i += 1) {
      const res = await chamar('/api/auth/entrar', {
        method: 'POST',
        body: JSON.stringify({ email: EMAIL, codigo: '000000' === codigo ? '111111' : '000000' }),
      });
      expect(await res.json()).toEqual({ error: 'codigo_invalido' });
    }

    // Esgotadas as tentativas, nem o código certo entra.
    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });
    expect(await res.json()).toEqual({ error: 'tentativas_esgotadas' });
  });

  it('recusa código expirado', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);

    await env.DB.prepare('UPDATE login_codes SET expires_at = ? WHERE user_id = ?')
      .bind('2020-01-01T00:00:00.000Z', id)
      .run();

    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });
    expect(res.status).toBe(401);
  });

  it('não aceita o código de um usuário no outro', async () => {
    const um = await criarUsuario('um@exemplo.com.br');
    await criarUsuario('dois@exemplo.com.br');
    await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: 'um@exemplo.com.br' }),
    });
    const codigo = await fixarCodigo(um);

    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: 'dois@exemplo.com.br', codigo }),
    });
    expect(res.status).toBe(401);
  });
});

describe('sessão', () => {
  async function entrar(): Promise<{ cookie: string; id: string }> {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);
    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });
    return { cookie: cookieDa(res), id };
  }

  it('/api/me recusa sem sessão', async () => {
    const res = await chamar('/api/me');
    expect(res.status).toBe(401);
  });

  it('/api/me devolve o usuário e o que ele tem', async () => {
    const { cookie, id } = await entrar();
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
       VALUES ('e1', ?, 'jornada-meu-anjo', 'manual', 'active', ?)`,
    )
      .bind(id, new Date().toISOString())
      .run();

    const res = await chamar('/api/me', { headers: { cookie } });
    const corpo = (await res.json()) as {
      temAcesso: boolean;
      produtos: Array<{ id: string }>;
      usuario: { email: string };
    };

    expect(res.status).toBe(200);
    expect(corpo.usuario.email).toBe(EMAIL);
    expect(corpo.temAcesso).toBe(true);
    expect(corpo.produtos.map((p) => p.id)).toEqual(['jornada-meu-anjo']);
  });

  it('quem não tem produto ativo entra, mas sem acesso', async () => {
    const { cookie } = await entrar();

    const res = await chamar('/api/me', { headers: { cookie } });
    const corpo = (await res.json()) as { temAcesso: boolean; suporte: string | null };

    expect(res.status).toBe(200);
    expect(corpo.temAcesso).toBe(false);
    // A tela de "nada liberado" precisa do contato do suporte (§14).
    expect(corpo.suporte).toBeTruthy();
  });

  it('entitlement revogado não conta como acesso', async () => {
    const { cookie, id } = await entrar();
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at, revoked_at)
       VALUES ('e1', ?, 'jornada-meu-anjo', 'payt', 'revoked', ?, ?)`,
    )
      .bind(id, new Date().toISOString(), new Date().toISOString())
      .run();

    const res = await chamar('/api/me', { headers: { cookie } });
    expect((await res.json()) as { temAcesso: boolean }).toMatchObject({ temAcesso: false });
  });

  it('sair encerra a sessão', async () => {
    const { cookie } = await entrar();

    await chamar('/api/auth/sair', { method: 'POST', headers: { cookie } });

    const res = await chamar('/api/me', { headers: { cookie } });
    expect(res.status).toBe(401);

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>();
    expect(r?.n).toBe(0);
  });

  it('sessão expirada não vale', async () => {
    const { cookie } = await entrar();
    await env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind('2020-01-01T00:00:00.000Z')
      .run();

    const res = await chamar('/api/me', { headers: { cookie } });
    expect(res.status).toBe(401);
  });

  it('a sessão vale um ano e o cookie acompanha', async () => {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);
    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });

    expect(SESSAO_DIAS).toBe(365);
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${SESSAO_DIAS * 24 * 60 * 60}`);

    const linha = await env.DB.prepare('SELECT expires_at FROM sessions').first<{
      expires_at: string;
    }>();
    const dias = (Date.parse(linha?.expires_at ?? '') - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(SESSAO_DIAS - 1);
    expect(dias).toBeLessThanOrEqual(SESSAO_DIAS);
  });

  it('renova a validade a cada uso', async () => {
    const { cookie } = await entrar();
    // Simula uma sessão aberta há meses: o uso de hoje tem que empurrar o prazo.
    await env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(new Date(Date.now() + 10 * 86_400_000).toISOString())
      .run();

    await chamar('/api/me', { headers: { cookie } });

    const linha = await env.DB.prepare('SELECT expires_at FROM sessions').first<{
      expires_at: string;
    }>();
    const dias = (Date.parse(linha?.expires_at ?? '') - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(SESSAO_DIAS - 1);
  });
});

/**
 * O link do e-mail que já entra (§8). É o que tira o código do caminho de quem
 * acabou de comprar: o e-mail de boas-vindas e o de anúncio levam este link.
 */
describe('link de acesso direto', () => {
  it('abre a sessão e manda para a Home', async () => {
    const id = await criarUsuario();
    const token = await criarLinkDeAcesso(env.DB, id);

    const res = await chamar(`/acesso?t=${token}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');

    const cookie = cookieDa(res);
    expect(cookie).toContain('sessao=');

    const me = await chamar('/api/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { usuario: { id: string } }).usuario.id).toBe(id);
  });

  it('guarda o token com hash, nunca em claro', async () => {
    const id = await criarUsuario();
    const token = await criarLinkDeAcesso(env.DB, id);

    const linha = await env.DB.prepare('SELECT token_hash FROM access_links WHERE user_id = ?')
      .bind(id)
      .first<{ token_hash: string }>();

    expect(linha?.token_hash).not.toContain(token);
    expect(linha?.token_hash).toHaveLength(64);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('vence em 7 dias', async () => {
    const id = await criarUsuario();
    await criarLinkDeAcesso(env.DB, id);

    const linha = await env.DB.prepare('SELECT expires_at FROM access_links').first<{
      expires_at: string;
    }>();
    const dias = (Date.parse(linha?.expires_at ?? '') - Date.now()) / 86_400_000;
    expect(LINK_ACESSO_DIAS).toBe(7);
    expect(dias).toBeGreaterThan(LINK_ACESSO_DIAS - 1);
    expect(dias).toBeLessThanOrEqual(LINK_ACESSO_DIAS);
  });

  it('é de uso único: na segunda vez cai no login com o e-mail preenchido', async () => {
    const id = await criarUsuario();
    const token = await criarLinkDeAcesso(env.DB, id);

    await chamar(`/acesso?t=${token}`);
    const segunda = await chamar(`/acesso?t=${token}`);

    expect(segunda.status).toBe(302);
    const destino = new URL(segunda.headers.get('location') ?? '', BASE);
    expect(destino.pathname).toBe('/entrar');
    expect(destino.searchParams.get('motivo')).toBe('link_usado');
    expect(destino.searchParams.get('e')).toBe(EMAIL);

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>();
    expect(r?.n).toBe(1);
  });

  it('vencido também cai no login, com o motivo certo', async () => {
    const id = await criarUsuario();
    const token = await criarLinkDeAcesso(env.DB, id);
    await env.DB.prepare('UPDATE access_links SET expires_at = ?')
      .bind('2020-01-01T00:00:00.000Z')
      .run();

    const res = await chamar(`/acesso?t=${token}`);

    const destino = new URL(res.headers.get('location') ?? '', BASE);
    expect(destino.searchParams.get('motivo')).toBe('link_expirado');
    expect(destino.searchParams.get('e')).toBe(EMAIL);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>()).toMatchObject(
      { n: 0 },
    );
  });

  it('token desconhecido não vaza e-mail nenhum', async () => {
    await criarUsuario();
    const res = await chamar('/acesso?t=naoexiste');

    const destino = new URL(res.headers.get('location') ?? '', BASE);
    expect(destino.pathname).toBe('/entrar');
    expect(destino.searchParams.get('motivo')).toBe('link_invalido');
    expect(destino.searchParams.has('e')).toBe(false);
  });

  it('link de conta excluída não entra', async () => {
    const id = await criarUsuario();
    const token = await criarLinkDeAcesso(env.DB, id);
    await env.DB.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), id)
      .run();

    const res = await chamar(`/acesso?t=${token}`);
    expect(new URL(res.headers.get('location') ?? '', BASE).searchParams.get('motivo')).toBe(
      'link_invalido',
    );
  });
});

/**
 * Excluir a conta e trocar o e-mail pedem código mesmo com sessão aberta (§8):
 * a sessão dura um ano, e um celular emprestado não pode virar perda de conta.
 */
describe('ação sensível', () => {
  async function comSessao(): Promise<{ cookie: string; id: string }> {
    const id = await criarUsuario();
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id);
    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });
    return { cookie: cookieDa(res), id };
  }

  async function codigoDaAcao(cookie: string, id: string, acao: string): Promise<string> {
    await chamar('/api/me/confirmar', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ acao }),
    });
    return fixarCodigo(id, '654321');
  }

  it('sem sessão não faz nada', async () => {
    const res = await chamar('/api/me/excluir', {
      method: 'POST',
      body: JSON.stringify({ codigo: '123456' }),
    });
    expect(res.status).toBe(401);
  });

  it('com sessão mas sem código, recusa', async () => {
    const { cookie } = await comSessao();
    const res = await chamar('/api/me/excluir', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ codigo: '000000' }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'codigo_invalido' });
  });

  it('o código de login não autoriza exclusão', async () => {
    const { cookie, id } = await comSessao();
    // Pede um código de LOGIN e tenta usá-lo para excluir a conta.
    await chamar('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
    const codigo = await fixarCodigo(id, '111111');

    const res = await chamar('/api/me/excluir', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ codigo }),
    });
    expect(res.status).toBe(401);
  });

  it('o código de ação não abre sessão', async () => {
    const { cookie, id } = await comSessao();
    const codigo = await codigoDaAcao(cookie, id, 'excluir_conta');

    const res = await chamar('/api/auth/entrar', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, codigo }),
    });
    expect(res.status).toBe(401);
  });

  it('com o código certo, exclui e anonimiza', async () => {
    const { cookie, id } = await comSessao();
    await env.DB.prepare(
      `INSERT INTO intentions (id, user_id, text, status, created_at)
       VALUES ('i1', ?, 'rezem por mim', 'visible', ?)`,
    )
      .bind(id, new Date().toISOString())
      .run();

    const codigo = await codigoDaAcao(cookie, id, 'excluir_conta');
    const res = await chamar('/api/me/excluir', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ codigo }),
    });

    expect(res.status).toBe(200);

    const u = await env.DB.prepare(
      'SELECT email, phone, name, deleted_at FROM users WHERE id = ?',
    )
      .bind(id)
      .first<{ email: string | null; phone: string | null; name: string | null; deleted_at: string | null }>();
    expect(u?.deleted_at).toBeTruthy();
    expect(u?.email).toBeNull();
    expect(u?.name).toBeNull();

    const intencao = await env.DB.prepare('SELECT status FROM intentions WHERE id = ?')
      .bind('i1')
      .first<{ status: string }>();
    expect(intencao?.status).toBe('hidden');

    // A sessão morre junto: ninguém continua dentro de uma conta excluída.
    expect(await (await chamar('/api/me', { headers: { cookie } })).status).toBe(401);
  });

  it('troca o e-mail com código, e o código vai para o endereço antigo', async () => {
    const { cookie, id } = await comSessao();

    await chamar('/api/me/confirmar', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ acao: 'trocar_email' }),
    });
    const codigo = await fixarCodigo(id, '654321');

    const res = await chamar('/api/me/email', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ codigo, email: 'NOVO@Exemplo.com.br' }),
    });

    expect(res.status).toBe(200);
    const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(id)
      .first<{ email: string }>();
    expect(u?.email).toBe('novo@exemplo.com.br');

  });

  it('o código da troca vai para o e-mail atual, não para o novo', async () => {
    const { id } = await comSessao();

    // É o acesso à caixa de hoje que prova que é a pessoa. Mandar para o
    // endereço novo deixaria um celular destravado virar perda de conta.
    const pedido = await pedirCodigoDeAcao(env.DB, id, 'trocar_email', null);
    expect(pedido).toMatchObject({ ok: true, email: EMAIL });
  });

  it('conta sem e-mail não tem para onde mandar o código', async () => {
    const { cookie, id } = await comSessao();
    await env.DB.prepare('UPDATE users SET email = NULL WHERE id = ?').bind(id).run();

    const res = await chamar('/api/me/confirmar', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ acao: 'excluir_conta' }),
    });

    expect(res.status).toBe(400);
    // A tela precisa do suporte para oferecer saída (§14).
    expect((await res.json()) as { error: string; suporte: string | null }).toMatchObject({
      error: 'sem_email',
    });
  });

  it('não deixa trocar para um e-mail que já é de outra conta', async () => {
    const { cookie, id } = await comSessao();
    await criarUsuario('outra@exemplo.com.br', 'Outra');
    const codigo = await codigoDaAcao(cookie, id, 'trocar_email');

    const res = await chamar('/api/me/email', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ codigo, email: 'outra@exemplo.com.br' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_em_uso' });
  });
});
