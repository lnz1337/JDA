import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSAO_DIAS } from '../src/shared/constants';
import app from '../src/worker/index';
import { criarLinkDeAcesso } from '../src/worker/services/auth';
import { chaveDoCelular, TENTATIVAS_POR_HORA } from '../src/worker/services/entrada';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

/**
 * Entrada sem código (docs/entrada-sem-codigo.md, CLAUDE.md §8): pelo celular ou
 * pelo e-mail da compra, e pronto.
 */
const EMAIL = 'pessoa@exemplo.com.br';
const CELULAR = '5518999991234';

async function chamar(
  caminho: string,
  init: RequestInit & { ip?: string } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const { ip, ...resto } = init;
  const res = await app.request(
    `https://exemplo.test${caminho}`,
    {
      ...resto,
      headers: {
        'content-type': 'application/json',
        ...(ip ? { 'cf-connecting-ip': ip } : {}),
        ...(resto.headers ?? {}),
      },
    },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const entrar = (corpo: Record<string, unknown>, ip = '203.0.113.1') =>
  chamar('/api/entrar', { method: 'POST', body: JSON.stringify(corpo), ip });

async function criarUsuario(
  id: string,
  dados: { email?: string | null; phone?: string | null; nome?: string | null } = {},
) {
  await env.DB.prepare(
    'INSERT INTO users (id, email, phone, name, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      dados.email === undefined ? EMAIL : dados.email,
      dados.phone === undefined ? CELULAR : dados.phone,
      dados.nome === undefined ? 'Maria Souza' : dados.nome,
      new Date().toISOString(),
    )
    .run();
}

async function sessoesDe(userId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

beforeEach(prepararBanco);

describe('chave do celular', () => {
  it('DDD + 8 últimos dígitos, com e sem 55, com e sem o 9, com máscara', () => {
    for (const v of [
      '(18) 99999-1234',
      '18999991234',
      '5518999991234',
      '+55 18 99999-1234',
      '1899991234',
      '551899991234',
    ]) {
      expect(chaveDoCelular(v)).toBe('1899991234');
    }
  });

  it('sem DDD ou com dígito de menos, não vale', () => {
    for (const v of ['99991234', '999991234', '', null, '123']) {
      expect(chaveDoCelular(v)).toBeNull();
    }
  });
});

describe('POST /api/entrar', () => {
  it('pelo celular, com máscara, entra e abre a sessão de sempre', async () => {
    await criarUsuario('u1');
    const res = await entrar({ celular: '(18) 99999-1234' });

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${SESSAO_DIAS * 24 * 60 * 60}`);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await sessoesDe('u1')).toBe(1);

    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect((await chamar('/api/me', { headers: { cookie } })).status).toBe(200);
  });

  it('celular gravado sem o 9 casa com o digitado com o 9, e vice-versa', async () => {
    await criarUsuario('u1', { phone: '1899991234' });
    expect((await entrar({ celular: '18 99999 1234' })).status).toBe(200);

    await prepararBanco();
    await criarUsuario('u2', { phone: '5518999991234' });
    expect((await entrar({ celular: '1899991234' })).status).toBe(200);
  });

  it('DDD diferente não entra, mesmo com os 8 últimos iguais', async () => {
    await criarUsuario('u1');
    expect((await entrar({ celular: '(11) 99999-1234' })).status).toBe(404);
  });

  it('pelo e-mail, com maiúscula e espaço', async () => {
    await criarUsuario('u1');
    expect((await entrar({ email: '  Pessoa@Exemplo.com.BR ' })).status).toBe(200);
  });

  it('não encontrado diz qual, sem abrir sessão', async () => {
    await criarUsuario('u1');
    const res = await entrar({ celular: '(18) 98888-0000' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'nao_encontrado' });
    expect(await sessoesDe('u1')).toBe(0);
  });

  it('dois usuários com o mesmo celular: pede o e-mail, não entra em nenhum', async () => {
    await criarUsuario('u1');
    await criarUsuario('u2', { email: 'filha@exemplo.com.br', phone: '18999991234' });

    const res = await entrar({ celular: '18999991234' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'varios' });
    expect((await sessoesDe('u1')) + (await sessoesDe('u2'))).toBe(0);

    // Com o e-mail, cada um entra na própria conta.
    expect((await entrar({ email: 'filha@exemplo.com.br' })).status).toBe(200);
    expect(await sessoesDe('u2')).toBe(1);
  });

  it('usuário excluído não entra', async () => {
    await criarUsuario('u1');
    await env.DB.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), 'u1')
      .run();
    expect((await entrar({ celular: CELULAR })).status).toBe(404);
    expect((await entrar({ email: EMAIL })).status).toBe(404);
  });

  it('corpo com os dois, com código ou vazio é recusado', async () => {
    for (const corpo of [
      { celular: CELULAR, email: EMAIL },
      { email: EMAIL, codigo: '123456' },
      {},
    ]) {
      expect((await entrar(corpo)).status).toBe(400);
    }
  });

  it('limite por IP: tentativas com números diferentes param no limite', async () => {
    for (let i = 0; i < TENTATIVAS_POR_HORA; i++) {
      const res = await entrar(
        { celular: `(18) 9000${String(i).padStart(4, '0')}` },
        '198.51.100.7',
      );
      expect(res.status).toBe(404);
    }
    const res = await entrar({ celular: '(18) 90009999' }, '198.51.100.7');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'limite', suporte: expect.any(String) });
  });

  it('limite por identificador: o mesmo número de IPs diferentes também para', async () => {
    await criarUsuario('u1');
    for (let i = 0; i < TENTATIVAS_POR_HORA; i++) {
      await entrar({ celular: CELULAR }, `192.0.2.${i + 1}`);
    }
    const res = await entrar({ celular: CELULAR }, '192.0.2.200');
    expect(res.status).toBe(429);
  });

  it('a entrada não manda e-mail nenhum', async () => {
    await criarUsuario('u1');
    await entrar({ celular: CELULAR });
    await entrar({ email: EMAIL });
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE name LIKE 'email_%'",
    ).first<{ n: number }>();
    expect(r?.n).toBe(0);
  });

  it('events: login e login_falhou com método e motivo, nunca o e-mail nem o número', async () => {
    await criarUsuario('u1');
    await entrar({ celular: '(18) 99999-1234' });
    await entrar({ email: 'ninguem@exemplo.com.br' });

    const { results } = await env.DB.prepare(
      "SELECT name, props_json FROM events WHERE name IN ('login', 'login_falhou') ORDER BY created_at",
    ).all<{ name: string; props_json: string }>();

    expect(results.map((r) => [r.name, JSON.parse(r.props_json)])).toEqual([
      ['login', { metodo: 'celular' }],
      ['login_falhou', { metodo: 'email', motivo: 'nao_encontrado' }],
    ]);
    for (const r of results) {
      expect(r.props_json).not.toMatch(/9999|1234|@/);
    }
    const tentativas = await env.DB.prepare('SELECT chave FROM login_tentativas').all<{
      chave: string;
    }>();
    for (const t of tentativas.results) expect(t.chave).not.toMatch(/9999|@/);
  });

  it('o link de acesso registra login com método link', async () => {
    await criarUsuario('u1');
    const token = await criarLinkDeAcesso(env.DB, 'u1');
    await chamar('/acesso', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `t=${encodeURIComponent(token)}`,
    });
    const r = await env.DB.prepare("SELECT props_json FROM events WHERE name = 'login'").first<{
      props_json: string;
    }>();
    expect(JSON.parse(r?.props_json ?? '{}')).toEqual({ metodo: 'link' });
  });

  it('a rota antiga do código de login não existe mais', async () => {
    await criarUsuario('u1');
    const res = await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL }),
    });
    expect(res.status).toBe(404);
  });
});

describe('o código continua onde protege', () => {
  it('excluir a conta continua exigindo o código', async () => {
    await criarUsuario('u1');
    const cookie =
      ((await entrar({ email: EMAIL })).headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const res = await chamar('/api/me/excluir', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ codigo: '000000' }),
    });
    expect(res.status).toBe(401);
    const u = await env.DB.prepare('SELECT deleted_at FROM users WHERE id = ?')
      .bind('u1')
      .first<{ deleted_at: string | null }>();
    expect(u?.deleted_at).toBeNull();
  });
});

describe('PATCH /api/me (nome)', () => {
  async function comSessao(): Promise<string> {
    await criarUsuario('u1', { nome: null });
    return ((await entrar({ email: EMAIL })).headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  it('grava o nome da saudação', async () => {
    const cookie = await comSessao();
    const res = await chamar('/api/me', {
      method: 'PATCH',
      headers: { cookie },
      body: JSON.stringify({ nome: '  Maria ' }),
    });
    expect(res.status).toBe(200);
    const me = (await (await chamar('/api/me', { headers: { cookie } })).json()) as {
      usuario: { nome: string };
    };
    expect(me.usuario.nome).toBe('Maria');
  });

  it('recusa nome longo demais e sem sessão', async () => {
    const cookie = await comSessao();
    expect(
      (
        await chamar('/api/me', {
          method: 'PATCH',
          headers: { cookie },
          body: JSON.stringify({ nome: 'x'.repeat(61) }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await chamar('/api/me', { method: 'PATCH', body: JSON.stringify({ nome: 'Maria' }) }))
        .status,
    ).toBe(401);
  });
});
