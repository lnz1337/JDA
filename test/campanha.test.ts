import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { destinatarios, linkParar } from '../src/worker/services/campanhas';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

const BASE = 'https://exemplo.test';
const CAMPANHA = 'anuncio-app';

/** O ambiente de teste não envia de verdade; o provedor falha e isso é o esperado. */
const ambienteBase = () => ({ ...envTeste, CAMPAIGN_SIGNING_KEY: 'chave-de-assinatura-de-teste' });

async function chamar(
  caminho: string,
  init: RequestInit = {},
  ambiente: Record<string, unknown> = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(
    `${BASE}${caminho}`,
    { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } },
    { ...ambienteBase(), ...ambiente },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const comChave = () => ({ 'x-admin-key': envTeste.ADMIN_API_KEY ?? '' });

async function criarComprador(n: number): Promise<string> {
  const id = `comprador-${n}`;
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, `c${n}@exemplo.com.br`, `Pessoa ${n}`, new Date(2026, 0, n + 1).toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
     VALUES (?, ?, 'jornada-meu-anjo', 'payt', 'active', ?)`,
  )
    .bind(`ent-${n}`, id, new Date().toISOString())
    .run();
  return id;
}

async function enviados(): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM campaign_sends WHERE campaign = ? AND status = 'sent'",
  )
    .bind(CAMPANHA)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

beforeEach(prepararBanco);

describe('autenticação do disparo', () => {
  it('recusa sem chave', async () => {
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('exige campanha e limite', async () => {
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA }),
    });
    expect(res.status).toBe(400);
  });
});

describe('seleção', () => {
  it('dry-run não grava nada', async () => {
    await criarComprador(1);

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 10, dry_run: true }),
    });

    expect((await res.json()) as { enviados: number }).toMatchObject({ enviados: 1, dryRun: true });
    expect(await enviados()).toBe(0);
  });

  it('ignora quem optou por não receber', async () => {
    await criarComprador(1);
    const id = await criarComprador(2);
    await env.DB.prepare('UPDATE users SET marketing_opt_out_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), id)
      .run();

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 10, dry_run: true }),
    });

    expect((await res.json()) as { enviados: number }).toMatchObject({ enviados: 1 });
  });

  it('ignora quem não tem produto ativo', async () => {
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind('sem-compra', 'sem@exemplo.com.br', new Date().toISOString())
      .run();

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 10, dry_run: true }),
    });

    expect((await res.json()) as { enviados: number }).toMatchObject({ enviados: 0 });
  });

  it('não reenvia para quem já recebeu', async () => {
    const id = await criarComprador(1);
    await criarComprador(2);
    await env.DB.prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, sent_at) VALUES (?, ?, 'sent', ?)`,
    )
      .bind(CAMPANHA, id, new Date().toISOString())
      .run();

    // Limite 2 e não 10: com 1 envio anterior, o guarda de onda só deixa dobrar.
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 2, dry_run: true }),
    });

    expect((await res.json()) as { enviados: number }).toMatchObject({ enviados: 1 });
  });

  it('teste-para não toca na base', async () => {
    await criarComprador(1);

    await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1, teste_para: 'eu@exemplo.com.br' }),
    });

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaign_sends').first<{ n: number }>();
    expect(r?.n).toBe(0);
  });
});

/**
 * E-mails enviados num dia, de qualquer tipo: é o volume que a trava lê.
 * Centenas de linhas num comando só: uma por uma estoura o tempo do teste.
 */
async function marcarEnviados(n: number, quando: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, name, props_json, created_at)
     WITH RECURSIVE contador(i) AS (
       SELECT 1 UNION ALL SELECT i + 1 FROM contador WHERE i < ?
     )
     SELECT 'ev-' || ? || '-' || i, 'email_enviado', '{}', ? FROM contador`,
  )
    .bind(n, quando, quando)
    .run();
}

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function disparar(corpo: Record<string, unknown>): Promise<Response> {
  return chamar('/api/campanha/enviar', {
    method: 'POST',
    headers: comChave(),
    body: JSON.stringify({ campanha: CAMPANHA, dry_run: true, ...corpo }),
  });
}

describe('volume do domínio (trava de onda)', () => {
  it('sem histórico, vale o piso da primeira onda (50)', async () => {
    await criarComprador(1);
    expect((await disparar({ limite: 50 })).status).toBe(200);
    expect((await disparar({ limite: 51 })).status).toBe(400);
  });

  it('o teto é o dobro do maior dia dos últimos 14', async () => {
    await criarComprador(1);
    await marcarEnviados(60, diasAtras(1));
    await marcarEnviados(30, diasAtras(3));

    expect((await disparar({ limite: 120 })).status).toBe(200);
    const res = await disparar({ limite: 121 });
    expect(res.status).toBe(400);
    const corpo = (await res.json()) as { error: string };
    // A mensagem diz de onde veio o teto.
    expect(corpo.error).toContain('máximo agora, que é 120');
    expect(corpo.error).toContain('maior dia dos últimos 14 = 60');
  });

  it('o que já saiu hoje conta contra o teto do dia', async () => {
    await criarComprador(1);
    await marcarEnviados(60, diasAtras(1));
    await marcarEnviados(30, new Date().toISOString());

    // Teto 120, 30 já saíram: sobram 90. Hoje não sobe o próprio teto.
    expect((await disparar({ limite: 90 })).status).toBe(200);
    expect((await disparar({ limite: 91 })).status).toBe(400);
  });

  it('dia fora da janela de 14 não conta', async () => {
    await criarComprador(1);
    await marcarEnviados(400, diasAtras(15));
    expect((await disparar({ limite: 51 })).status).toBe(400);
  });

  it('campanha nova não recomeça do zero: conta o domínio', async () => {
    await criarComprador(1);
    // 400 do anúncio ontem: o lembrete, que nunca enviou nada, pode mandar 800.
    await marcarEnviados(400, diasAtras(1));
    const res = await disparar({ campanha: 'lembrete-app', limite: 400 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ maiorDia: 400, tetoDoDia: 800 });
  });
});

describe('parar de receber', () => {
  it('marca o opt-out com link assinado', async () => {
    const id = await criarComprador(1);
    const link = await linkParar(ambienteBase() as never, id);
    const url = new URL(link);

    const res = await chamar(`/parar${url.search}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('código de acesso continuam');

    const u = await env.DB.prepare('SELECT marketing_opt_out_at FROM users WHERE id = ?')
      .bind(id)
      .first<{ marketing_opt_out_at: string | null }>();
    expect(u?.marketing_opt_out_at).toBeTruthy();
  });

  it('recusa assinatura inválida', async () => {
    const id = await criarComprador(1);

    const res = await chamar(`/parar?u=${id}&t=assinatura-errada`);
    expect(res.status).toBe(400);

    const u = await env.DB.prepare('SELECT marketing_opt_out_at FROM users WHERE id = ?')
      .bind(id)
      .first<{ marketing_opt_out_at: string | null }>();
    expect(u?.marketing_opt_out_at).toBeNull();
  });

  it('quem optou por sair continua podendo pedir código de login', async () => {
    const id = await criarComprador(1);
    await env.DB.prepare('UPDATE users SET marketing_opt_out_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), id)
      .run();

    await chamar('/api/auth/codigo', {
      method: 'POST',
      body: JSON.stringify({ email: 'c1@exemplo.com.br' }),
    });

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE user_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(r?.n).toBe(1);
  });
});

describe('texto da campanha', () => {
  it('monta o e-mail com os produtos do cliente', async () => {
    const { montarAnuncio } = await import('../src/worker/emails/anuncio');
    const email = montarAnuncio({
      primeiro_nome: 'Maria',
      link_acesso: 'https://exemplo.test/acesso?t=tok',
      lista_produtos: '- Jornada com São Miguel\n- Oração de Gargano',
      link_parar: 'https://exemplo.test/parar?u=1&t=2',
      email_suporte: 'suporte@exemplo.com.br',
    });

    expect(email.assunto).toContain('Maria');
    expect(email.texto).toContain('Jornada com São Miguel');
    expect(email.texto).toContain('Oração de Gargano');
    expect(email.html).toContain('href="https://exemplo.test/acesso?t=tok"');
    // Nada de variável por substituir.
    expect(email.texto).not.toContain('{{');
    expect(email.html).not.toContain('{{');
  });

  it('cada destinatário recebe um token próprio; dry-run não gera token', async () => {
    await criarComprador(1);
    await criarComprador(2);

    await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: { 'x-admin-key': envTeste.ADMIN_API_KEY ?? '' },
      body: JSON.stringify({ campanha: CAMPANHA, limite: 2, dry_run: true }),
    });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM access_links').first<{ n: number }>(),
    ).toMatchObject({ n: 0 });

    await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: { 'x-admin-key': envTeste.ADMIN_API_KEY ?? '' },
      body: JSON.stringify({ campanha: CAMPANHA, limite: 2 }),
    });

    const { results } = await env.DB.prepare(
      'SELECT user_id, token_hash FROM access_links',
    ).all<{ user_id: string; token_hash: string }>();

    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.user_id)).size).toBe(2);
    expect(new Set(results.map((r) => r.token_hash)).size).toBe(2);
  });
});

describe('ordem das ondas', () => {
  /** Cria um comprador com e-mail e data de compra escolhidos. */
  async function comprador(email: string, compra: string): Promise<string> {
    const id = `u-${email}`;
    await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, email, 'Pessoa', '2026-01-01T00:00:00.000Z')
      .run();
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
       VALUES (?, ?, 'jornada-meu-anjo', 'payt', 'active', ?)`,
    )
      .bind(`e-${email}`, id, compra)
      .run();
    return id;
  }

  async function fila(provedores: string[] = []): Promise<string[]> {
    const lista = await destinatarios(env.DB, CAMPANHA, 50, provedores);
    return lista.map((d) => d.email);
  }

  beforeEach(async () => {
    await comprador('antigo@gmail.com', '2024-03-01T00:00:00.000Z');
    await comprador('novo@hotmail.com', '2026-10-01T00:00:00.000Z');
    await comprador('meio@gmail.com', '2025-06-01T00:00:00.000Z');
    await comprador('recente@terra.com.br', '2026-10-15T00:00:00.000Z');
  });

  it('sem provedor, vai da compra mais recente para a mais antiga', async () => {
    expect(await fila()).toEqual([
      'recente@terra.com.br',
      'novo@hotmail.com',
      'meio@gmail.com',
      'antigo@gmail.com',
    ]);
  });

  it('com --provedores gmail, o Gmail vem na frente e a data desempata dentro dele', async () => {
    expect(await fila(['gmail'])).toEqual([
      'meio@gmail.com',
      'antigo@gmail.com',
      // Quem não é do provedor pedido continua na fila, atrás.
      'recente@terra.com.br',
      'novo@hotmail.com',
    ]);
  });

  it('aceita mais de um provedor, na ordem pedida', async () => {
    expect(await fila(['outlook', 'gmail'])).toEqual([
      'novo@hotmail.com',
      'meio@gmail.com',
      'antigo@gmail.com',
      'recente@terra.com.br',
    ]);
  });

  it('provedor desconhecido para o disparo, com a lista do que vale', async () => {
    await expect(fila(['gmial'])).rejects.toThrow(/gmial.*Conhecidos:.*gmail/s);

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1, dry_run: true, provedores: ['gmial'] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('provedor desconhecido');
  });

  it('o disparo respeita a ordem: a primeira onda só pega Gmail', async () => {
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 2, provedores: ['gmail'] }),
    });

    expect(res.status).toBe(200);
    const { results } = await env.DB.prepare(
      'SELECT user_id FROM campaign_sends ORDER BY user_id',
    ).all<{ user_id: string }>();

    expect(results.map((r) => r.user_id).sort()).toEqual([
      'u-antigo@gmail.com',
      'u-meio@gmail.com',
    ]);
  });
});

describe('separação de credenciais', () => {
  it('a chave da Payt não dispara campanha', async () => {
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: { 'x-admin-key': envTeste.PAYT_INTEGRATION_KEY ?? '' },
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1, dry_run: true }),
    });
    expect(res.status).toBe(401);
  });
});

describe('cota diária', () => {
  /**
   * 650 hoje e um dia de 500 ontem: a trava de volume (teto 1.000) fica folgada
   * e o que limita é só a cota.
   */
  async function marcarEnviadosHoje(n: number): Promise<void> {
    await marcarEnviados(500, diasAtras(1));
    await marcarEnviados(n, new Date().toISOString());
  }

  it('reserva 300 envios para o transacional', async () => {
    await criarComprador(1);
    // 650 já enviados hoje: sobram 1000 - 650 - 300 = 50 para campanha.
    await marcarEnviadosHoje(650);

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 51 }),
    });

    expect(res.status).toBe(400);
    const corpo = (await res.json()) as { error: string };
    expect(corpo.error).toContain('máximo agora, que é 50');
    expect(corpo.error).toContain('300 reservado');
  });

  it('aceita o que cabe na cota', async () => {
    await criarComprador(1);
    await marcarEnviadosHoje(650);

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 50, dry_run: true }),
    });
    expect(res.status).toBe(200);
  });

  it('informa a cota restante no relatório', async () => {
    await criarComprador(1);

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1, dry_run: true }),
    });

    expect((await res.json()) as { cotaRestante: number }).toMatchObject({ cotaRestante: 1000 });
  });
});

describe('modelo do anúncio', () => {
  async function modeloGravado(userId: string): Promise<string | null | undefined> {
    const r = await env.DB.prepare('SELECT model FROM campaign_sends WHERE campaign = ? AND user_id = ?')
      .bind(CAMPANHA, userId)
      .first<{ model: string | null }>();
    return r?.model;
  }

  it('grava qual modelo foi para cada pessoa', async () => {
    const id = await criarComprador(1);
    await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1, modelo: 'curto' }),
    });
    expect(await modeloGravado(id)).toBe('curto');
  });

  it('sem --modelo, vai o completo', async () => {
    const id = await criarComprador(1);
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1 }),
    });
    expect(await res.json()).toMatchObject({ modelo: 'padrao' });
    expect(await modeloGravado(id)).toBe('padrao');
  });

  it('quem recebeu um modelo não recebe o outro', async () => {
    const id = await criarComprador(1);
    await env.DB.prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, sent_at, model) VALUES (?, ?, 'sent', ?, 'padrao')`,
    )
      .bind(CAMPANHA, id, new Date().toISOString())
      .run();

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 2, dry_run: true, modelo: 'curto' }),
    });
    expect(await res.json()).toMatchObject({ enviados: 0 });
  });

  it('modelo desconhecido é recusado, sem cair no completo', async () => {
    await criarComprador(1);
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 1, modelo: 'curtinho' }),
    });
    expect(res.status).toBe(400);
    expect(await enviados()).toBe(0);
  });
});

describe('quem já recebeu as boas-vindas', () => {
  async function boasVindas(userId: string, nome: 'email_enviado' | 'email_falhou'): Promise<void> {
    await env.DB.prepare(
      'INSERT INTO events (id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(`ev-${userId}-${nome}`, userId, nome, JSON.stringify({ tipo: 'boas_vindas' }), new Date().toISOString())
      .run();
  }

  it('fica fora da campanha: já tem o link de acesso', async () => {
    const recebeu = await criarComprador(1);
    const naoRecebeu = await criarComprador(2);
    await boasVindas(recebeu, 'email_enviado');

    const ids = (await destinatarios(env.DB, CAMPANHA, 10)).map((d) => d.user_id);
    expect(ids).toEqual([naoRecebeu]);
  });

  it('boas-vindas que falhou não tira da campanha', async () => {
    const id = await criarComprador(1);
    await boasVindas(id, 'email_falhou');

    const ids = (await destinatarios(env.DB, CAMPANHA, 10)).map((d) => d.user_id);
    expect(ids).toEqual([id]);
  });
});

describe('campanha lembrete-app', () => {
  const LEMBRETE = 'lembrete-app';
  const AGORA = new Date().toISOString();
  const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  async function recebeuAnuncio(userId: string, quando: string, status = 'sent'): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, sent_at, model) VALUES ('anuncio-app', ?, ?, ?, 'curto')`,
    )
      .bind(userId, status, quando)
      .run();
  }

  const selecionados = async () =>
    (await destinatarios(env.DB, LEMBRETE, 50, [], AGORA)).map((d) => d.user_id);

  it('recebeu o anúncio há 7 dias ou mais e nunca entrou: recebe', async () => {
    const id = await criarComprador(1);
    await recebeuAnuncio(id, diasAtras(8));
    expect(await selecionados()).toEqual([id]);
  });

  it('anúncio há menos de 7 dias: ainda não', async () => {
    const id = await criarComprador(1);
    await recebeuAnuncio(id, diasAtras(6));
    expect(await selecionados()).toEqual([]);
  });

  it('não recebeu o anúncio, ou o envio falhou: fora', async () => {
    await criarComprador(1);
    const falhou = await criarComprador(2);
    await recebeuAnuncio(falhou, diasAtras(8), 'failed');
    expect(await selecionados()).toEqual([]);
  });

  it('quem entrou por link, por código ou tem sessão fica fora', async () => {
    const link = await criarComprador(1);
    const codigo = await criarComprador(2);
    const sessao = await criarComprador(3);
    const nunca = await criarComprador(4);
    for (const id of [link, codigo, sessao, nunca]) await recebeuAnuncio(id, diasAtras(10));

    await env.DB.prepare(
      'INSERT INTO access_links (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('al-1', link, 'hash-1', AGORA, diasAtras(9), diasAtras(10))
      .run();
    await env.DB.prepare(
      "INSERT INTO login_codes (id, user_id, code_hash, purpose, expires_at, used_at, created_at) VALUES (?, ?, 'h', 'login', ?, ?, ?)",
    )
      .bind('lc-1', codigo, AGORA, diasAtras(9), diasAtras(9))
      .run();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind('s-lembrete', sessao, AGORA, diasAtras(9))
      .run();

    expect(await selecionados()).toEqual([nunca]);
  });

  it('código pedido e não usado não conta como entrada', async () => {
    const id = await criarComprador(1);
    await recebeuAnuncio(id, diasAtras(8));
    await env.DB.prepare(
      "INSERT INTO login_codes (id, user_id, code_hash, purpose, expires_at, created_at) VALUES ('lc-2', ?, 'h', 'login', ?, ?)",
    )
      .bind(id, AGORA, diasAtras(7))
      .run();
    expect(await selecionados()).toEqual([id]);
  });

  it('quem pediu para parar fica fora', async () => {
    const id = await criarComprador(1);
    await recebeuAnuncio(id, diasAtras(8));
    await env.DB.prepare('UPDATE users SET marketing_opt_out_at = ? WHERE id = ?').bind(AGORA, id).run();
    expect(await selecionados()).toEqual([]);
  });

  it('quem já recebeu o lembrete não recebe de novo', async () => {
    const id = await criarComprador(1);
    await recebeuAnuncio(id, diasAtras(8));
    await env.DB.prepare(
      "INSERT INTO campaign_sends (campaign, user_id, status, sent_at, model) VALUES ('lembrete-app', ?, 'sent', ?, 'lembrete')",
    )
      .bind(id, AGORA)
      .run();
    expect(await selecionados()).toEqual([]);
  });

  it('o disparo usa o texto do lembrete e grava o modelo', async () => {
    const id = await criarComprador(1);
    await recebeuAnuncio(id, diasAtras(8));
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: LEMBRETE, limite: 1 }),
    });
    expect(await res.json()).toMatchObject({ modelo: 'lembrete' });
    const r = await env.DB.prepare("SELECT model FROM campaign_sends WHERE campaign = 'lembrete-app' AND user_id = ?")
      .bind(id)
      .first<{ model: string }>();
    expect(r?.model).toBe('lembrete');
  });

  it('modelo do anúncio na campanha de lembrete é recusado', async () => {
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: LEMBRETE, limite: 1, modelo: 'curto' }),
    });
    expect(res.status).toBe(400);
  });

  it('campanha com nome desconhecido é recusada, sem mandar para a base', async () => {
    await criarComprador(1);
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: 'anuncio-ap', limite: 1 }),
    });
    expect(res.status).toBe(400);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaign_sends').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
