import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { linkParar } from '../src/worker/services/campanhas';
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

describe('ondas', () => {
  it('a primeira onda define o tamanho', async () => {
    for (let i = 1; i <= 3; i += 1) await criarComprador(i);

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 50, dry_run: true }),
    });
    expect(res.status).toBe(200);
  });

  it('recusa limite maior que o dobro da onda anterior', async () => {
    const id = await criarComprador(1);
    await env.DB.prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, sent_at) VALUES (?, ?, 'sent', ?)`,
    )
      .bind(CAMPANHA, id, new Date().toISOString())
      .run();

    // Onda anterior: 1 envio. Teto: 2.
    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 10 }),
    });

    expect(res.status).toBe(400);
    const corpo = (await res.json()) as { error: string };
    // A mensagem diz o teto efetivo e de onde ele veio: onda e cota do dia.
    expect(corpo.error).toContain('máximo agora, que é 2');
    expect(corpo.error).toContain('Onda anterior: 1');
    expect(corpo.error).toContain('Cota do dia: 1000');
  });

  it('aceita exatamente o dobro', async () => {
    const id = await criarComprador(1);
    await env.DB.prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, sent_at) VALUES (?, ?, 'sent', ?)`,
    )
      .bind(CAMPANHA, id, new Date().toISOString())
      .run();

    const res = await chamar('/api/campanha/enviar', {
      method: 'POST',
      headers: comChave(),
      body: JSON.stringify({ campanha: CAMPANHA, limite: 2, dry_run: true }),
    });
    expect(res.status).toBe(200);
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
      link_acesso: 'https://exemplo.test/entrar?e=maria%40exemplo.com.br',
      lista_produtos: '- Jornada com São Miguel\n- Oração de Gargano',
      link_parar: 'https://exemplo.test/parar?u=1&t=2',
      email_suporte: 'suporte@exemplo.com.br',
    });

    expect(email.assunto).toContain('Maria');
    expect(email.texto).toContain('Jornada com São Miguel');
    expect(email.texto).toContain('Oração de Gargano');
    expect(email.html).toContain('<a href="https://exemplo.test/entrar?e=maria%40exemplo.com.br">');
    // Nada de variável por substituir.
    expect(email.texto).not.toContain('{{');
    expect(email.html).not.toContain('{{');
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
  /** Centenas de linhas num comando só: uma por uma estoura o tempo do teste. */
  async function marcarEnviadosHoje(n: number): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO events (id, name, props_json, created_at)
       WITH RECURSIVE contador(i) AS (
         SELECT 1 UNION ALL SELECT i + 1 FROM contador WHERE i < ?
       )
       SELECT 'ev-' || i, 'email_enviado', '{}', ? FROM contador`,
    )
      .bind(n, new Date().toISOString())
      .run();
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
