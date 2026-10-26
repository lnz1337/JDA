import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import {
  assuntoVapidValido,
  enviarERegistrar,
  enviarPush,
  servicoDoEndpoint,
  vapidConfigurado,
} from '../src/worker/services/push';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

const BASE = 'https://exemplo.test';
const USER = 'u-push';
const COOKIE = 'sessao=s-push';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/aparelho-1';
/** Chave pública P-256 de verdade: a biblioteca recusa ponto inválido. */
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

async function criarUsuario(id = USER, sessao = 's-push'): Promise<void> {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, `${id}@exemplo.com.br`, 'Pessoa', agora)
    .run();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(sessao, id, new Date(Date.now() + 86_400_000).toISOString(), agora)
    .run();
}

const assinatura = (endpoint = ENDPOINT) => ({ endpoint, p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) });

beforeEach(prepararBanco);

/*
 * O endpoint vem do navegador, mas quem manda é um cliente. Sem lista, quem
 * conseguir gravar uma assinatura usa o Worker para disparar POST com a nossa
 * origem para a URL que quiser.
 */
describe('serviços de push aceitos', () => {
  it('aceita os serviços de verdade', () => {
    expect(servicoDoEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe('fcm');
    expect(servicoDoEndpoint('https://web.push.apple.com/abc')).toBe('apple');
    expect(servicoDoEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
      'mozilla',
    );
    expect(servicoDoEndpoint('https://sin.notify.windows.com/w/?token=x')).toBe('windows');
  });

  it('recusa qualquer outro destino', () => {
    for (const ruim of [
      'https://exemplo.test/webhook',
      'http://fcm.googleapis.com/fcm/send/x', // sem https
      'https://fcm.googleapis.com.exemplo.test/x', // sufixo fingido
      'https://malpush.apple.com/x', // falta o ponto antes de push.apple.com
      'https://apple.com/x',
      'nao-e-url',
      '',
    ]) {
      expect(servicoDoEndpoint(ruim), ruim).toBeNull();
    }
  });
});

describe('assinatura do aparelho', () => {
  it('exige sessão', async () => {
    const res = await chamar('/api/push/assinatura', {
      method: 'POST',
      body: JSON.stringify(assinatura()),
    });
    expect(res.status).toBe(401);
  });

  it('grava a assinatura', async () => {
    await criarUsuario();
    const res = await chamar('/api/push/assinatura', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify(assinatura()),
    });

    expect(res.status).toBe(200);
    const linha = await env.DB.prepare(
      'SELECT user_id, endpoint FROM push_subscriptions',
    ).first<{ user_id: string; endpoint: string }>();
    expect(linha).toMatchObject({ user_id: USER, endpoint: ENDPOINT });
  });

  it('recusa endpoint fora dos serviços conhecidos', async () => {
    await criarUsuario();
    const res = await chamar('/api/push/assinatura', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify(assinatura('https://exemplo.test/webhook')),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'endpoint_nao_aceito' });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
      n: number;
    }>();
    expect(n?.n).toBe(0);
  });

  it('o mesmo aparelho em outra conta muda de dono', async () => {
    await criarUsuario();
    await criarUsuario('u-outra', 's-outra');

    await chamar('/api/push/assinatura', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify(assinatura()),
    });
    await chamar('/api/push/assinatura', {
      method: 'POST',
      headers: { cookie: 'sessao=s-outra' },
      body: JSON.stringify(assinatura()),
    });

    // Um aparelho, um dono: senão o lembrete continuaria indo para a conta antiga.
    const { results } = await env.DB.prepare(
      'SELECT user_id FROM push_subscriptions',
    ).all<{ user_id: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.user_id).toBe('u-outra');
  });

  it('tira a assinatura deste aparelho, e só dele', async () => {
    await criarUsuario();
    for (const e of [ENDPOINT, 'https://fcm.googleapis.com/fcm/send/aparelho-2']) {
      await chamar('/api/push/assinatura', {
        method: 'POST',
        headers: { cookie: COOKIE },
        body: JSON.stringify(assinatura(e)),
      });
    }

    const res = await chamar('/api/push/assinatura', {
      method: 'DELETE',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ endpoint: ENDPOINT }),
    });

    expect(res.status).toBe(200);
    const { results } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all<{
      endpoint: string;
    }>();
    expect(results.map((r) => r.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/aparelho-2',
    ]);
  });

  it('não dá para apagar a assinatura de outra conta', async () => {
    await criarUsuario();
    await criarUsuario('u-outra', 's-outra');
    await chamar('/api/push/assinatura', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify(assinatura()),
    });

    await chamar('/api/push/assinatura', {
      method: 'DELETE',
      headers: { cookie: 'sessao=s-outra' },
      body: JSON.stringify({ endpoint: ENDPOINT }),
    });

    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
      n: number;
    }>();
    expect(n?.n).toBe(1);
  });

  it('a chave pública sai para quem está logado', async () => {
    await criarUsuario();
    const res = await chamar('/api/push/chave', { headers: { cookie: COOKIE } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chave: string }).chave).toBeTruthy();

    expect((await chamar('/api/push/chave')).status).toBe(401);
  });
});

/**
 * O que o serviço de push responde decide o que acontece com a assinatura. O
 * `fetch` é trocado para o teste não sair pela internet — a criptografia já tem
 * teste próprio em `push-cripto.test.ts`.
 */
describe('resposta do serviço de push', () => {
  const original = globalThis.fetch;

  async function comResposta(status: number): Promise<void> {
    globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
    try {
      await enviarERegistrar(
        envTeste,
        USER,
        { id: 'sub-1', endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH },
        { titulo: 'oi', corpo: 'teste', url: '/' },
      );
    } finally {
      globalThis.fetch = original;
    }
  }

  async function prepararAssinatura(): Promise<void> {
    await criarUsuario();
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES ('sub-1', ?, ?, ?, ?, ?)`,
    )
      .bind(USER, ENDPOINT, P256DH, AUTH, new Date().toISOString())
      .run();
  }

  for (const status of [404, 410]) {
    it(`${status} apaga a assinatura: aquele aparelho não existe mais`, async () => {
      await prepararAssinatura();
      await comResposta(status);

      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
        n: number;
      }>();
      expect(n?.n).toBe(0);

      const evento = await env.DB.prepare(
        "SELECT name, props_json FROM events WHERE name LIKE 'push_%'",
      ).first<{ name: string; props_json: string }>();
      expect(evento?.name).toBe('push_falhou');
      // O evento guarda o serviço, nunca o endpoint — ele é credencial de entrega.
      expect(JSON.parse(evento?.props_json ?? '{}')).toMatchObject({ servico: 'fcm' });
      expect(evento?.props_json).not.toContain('fcm.googleapis.com/fcm/send');
    });
  }

  it('erro passageiro (500) mantém a assinatura', async () => {
    await prepararAssinatura();
    await comResposta(500);

    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
      n: number;
    }>();
    expect(n?.n).toBe(1);
  });

  it('sucesso marca o último envio que deu certo', async () => {
    await prepararAssinatura();
    await comResposta(201);

    const linha = await env.DB.prepare(
      'SELECT last_success_at FROM push_subscriptions WHERE id = ?',
    )
      .bind('sub-1')
      .first<{ last_success_at: string | null }>();

    expect(linha?.last_success_at).toBeTruthy();
    const evento = await env.DB.prepare(
      "SELECT name FROM events WHERE name LIKE 'push_%'",
    ).first<{ name: string }>();
    expect(evento?.name).toBe('push_enviado');
  });

  it('endpoint que não é de serviço conhecido nem chega a sair', async () => {
    await criarUsuario();
    let chamou = false;
    globalThis.fetch = (async () => {
      chamou = true;
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    try {
      const r = await enviarPush(
        envTeste,
        { endpoint: 'https://exemplo.test/webhook', p256dh: P256DH, auth: AUTH },
        { titulo: 'oi', corpo: 'x', url: '/' },
      );
      expect(r.ok).toBe(false);
      expect(chamou).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('horário do lembrete', () => {
  it('guarda hora e fuso na conta', async () => {
    await criarUsuario();
    const res = await chamar('/api/me/lembrete', {
      method: 'PATCH',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ prayer_hour: 18, timezone: 'America/Manaus' }),
    });

    expect(await res.json()).toMatchObject({ prayer_hour: 18, timezone: 'America/Manaus' });
    const u = await env.DB.prepare('SELECT prayer_hour, timezone FROM users WHERE id = ?')
      .bind(USER)
      .first<{ prayer_hour: number; timezone: string }>();
    expect(u).toMatchObject({ prayer_hour: 18, timezone: 'America/Manaus' });
  });

  it('fuso que não existe cai no padrão, em vez de sumir com o lembrete', async () => {
    await criarUsuario();
    const res = await chamar('/api/me/lembrete', {
      method: 'PATCH',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ prayer_hour: 7, timezone: 'Marte/Olympus' }),
    });

    expect(await res.json()).toMatchObject({ timezone: 'America/Sao_Paulo' });
  });

  it('recusa hora fora de 0..23', async () => {
    await criarUsuario();
    for (const hora of [-1, 24, 7.5, 'sete']) {
      const res = await chamar('/api/me/lembrete', {
        method: 'PATCH',
        headers: { cookie: COOKIE },
        body: JSON.stringify({ prayer_hour: hora }),
      });
      expect(res.status, String(hora)).toBe(400);
    }
  });

  it('exige sessão', async () => {
    const res = await chamar('/api/me/lembrete', {
      method: 'PATCH',
      body: JSON.stringify({ prayer_hour: 7 }),
    });
    expect(res.status).toBe(401);
  });
});

/*
 * A Apple recusa o envio com 403 e `BadJwtToken` quando o `sub` do JWT não é
 * mailto: nem https — e um 403 sem corpo não diz qual dos motivos foi. Pegar o
 * formato aqui é mais barato que descobrir pelo aparelho.
 */
describe('assunto VAPID', () => {
  it('aceita mailto: e https', () => {
    expect(assuntoVapidValido('mailto:suporte@exemplo.test')).toBe(true);
    expect(assuntoVapidValido('https://exemplo.test')).toBe(true);
  });

  it('recusa o que a Apple recusaria', () => {
    // E-mail sem o mailto: é o erro fácil de cometer no wrangler secret put.
    expect(assuntoVapidValido('suporte@exemplo.test')).toBe(false);
    expect(assuntoVapidValido('http://exemplo.test')).toBe(false);
    expect(assuntoVapidValido('')).toBe(false);
    expect(assuntoVapidValido('mailto:')).toBe(false);
  });

  it('assunto torto deixa o VAPID como não configurado', () => {
    expect(vapidConfigurado(envTeste)).toBe(true);
    expect(vapidConfigurado({ ...envTeste, VAPID_SUBJECT: 'suporte@exemplo.test' })).toBe(false);
  });

  it('com assunto torto nem tenta enviar', async () => {
    const original = globalThis.fetch;
    let chamou = false;
    globalThis.fetch = (async () => {
      chamou = true;
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    try {
      const r = await enviarPush(
        { ...envTeste, VAPID_SUBJECT: 'suporte@exemplo.test' },
        { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH },
        { titulo: 'oi', corpo: 'x', url: '/' },
      );
      expect(chamou).toBe(false);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.erro).toContain('VAPID_SUBJECT');
        // Config errada não é aparelho morto: a assinatura fica.
        expect(r.removerAssinatura).toBe(false);
      }
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('motivo que o serviço de push devolveu', () => {
  const original = globalThis.fetch;

  it('o 403 da Apple leva o BadJwtToken para o erro', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ reason: 'BadJwtToken' }), { status: 403 })) as typeof fetch;

    try {
      const r = await enviarPush(
        envTeste,
        { endpoint: 'https://web.push.apple.com/aparelho', p256dh: P256DH, auth: AUTH },
        { titulo: 'oi', corpo: 'x', url: '/' },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(403);
        expect(r.erro).toContain('403');
        expect(r.erro).toContain('BadJwtToken');
        // 403 é configuração, não aparelho que sumiu.
        expect(r.removerAssinatura).toBe(false);
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it('o motivo entra no evento, e sem endpoint', async () => {
    await criarUsuario();
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('sub-apple', USER, 'https://web.push.apple.com/aparelho', P256DH, AUTH, new Date().toISOString())
      .run();

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ reason: 'BadJwtToken' }), { status: 403 })) as typeof fetch;

    try {
      await enviarERegistrar(
        envTeste,
        USER,
        { id: 'sub-apple', endpoint: 'https://web.push.apple.com/aparelho', p256dh: P256DH, auth: AUTH },
        { titulo: 'oi', corpo: 'x', url: '/' },
      );
    } finally {
      globalThis.fetch = original;
    }

    const evento = await env.DB.prepare(
      "SELECT props_json FROM events WHERE name = 'push_falhou'",
    ).first<{ props_json: string }>();
    expect(JSON.parse(evento?.props_json ?? '{}')).toMatchObject({
      servico: 'apple',
      status: 403,
    });
    expect(evento?.props_json).toContain('BadJwtToken');
    expect(evento?.props_json).not.toContain('web.push.apple.com');
  });

  it('corpo gigante não vira evento gigante', async () => {
    globalThis.fetch = (async () =>
      new Response('x'.repeat(5000), { status: 400 })) as typeof fetch;

    try {
      const r = await enviarPush(
        envTeste,
        { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH },
        { titulo: 'oi', corpo: 'x', url: '/' },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erro.length).toBeLessThan(300);
    } finally {
      globalThis.fetch = original;
    }
  });
});

/*
 * O push de confirmação é o que prova a corrente inteira enquanto a pessoa
 * ainda está na tela. Quando ele falha, o status do serviço de push precisa
 * voltar: sem Mac para inspecionar o iPhone, é a única pista na mão.
 */
describe('push de confirmação', () => {
  const original = globalThis.fetch;

  async function comAssinatura(endpoint: string): Promise<void> {
    await criarUsuario();
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('sub-conf', USER, endpoint, P256DH, AUTH, new Date().toISOString())
      .run();
  }

  it('sem assinatura responde 404, não 502', async () => {
    await criarUsuario();
    const res = await chamar('/api/push/confirmacao', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ hora: 18 }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'sem_assinatura' });
  });

  it('o 403 da Apple volta com status e motivo', async () => {
    await comAssinatura('https://web.push.apple.com/aparelho');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ reason: 'BadJwtToken' }), { status: 403 })) as typeof fetch;

    try {
      const res = await chamar('/api/push/confirmacao', {
        method: 'POST',
        headers: { cookie: COOKIE },
        body: JSON.stringify({ hora: 18 }),
      });
      expect(res.status).toBe(502);
      const corpo = (await res.json()) as { error: string; status?: number; detalhe?: string };
      expect(corpo.error).toBe('envio_falhou');
      expect(corpo.status).toBe(403);
      expect(corpo.detalhe).toContain('BadJwtToken');
      // Nem aqui o endpoint aparece.
      expect(JSON.stringify(corpo)).not.toContain('web.push.apple.com');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('deu certo não leva detalhe nenhum', async () => {
    await comAssinatura(ENDPOINT);
    globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;

    try {
      const res = await chamar('/api/push/confirmacao', {
        method: 'POST',
        headers: { cookie: COOKIE },
        body: JSON.stringify({ hora: 18 }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });
});
