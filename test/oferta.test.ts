import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Oferta } from '../src/shared/types';
import app from '../src/worker/index';
import { DIAS_DISPENSADA, getOffer, registrarOfertaDispensada } from '../src/worker/services/offers';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

/**
 * O card de oferta da Home (CLAUDE.md §9): UP1 nos dias 5 a 9, UP2 nos dias 10
 * a 18, só para quem não tem o pacote, e nada nos dias 1 a 4 nem sem matrícula.
 */
const USER = 'u-oferta';
const COOKIE = 'sessao=s-oferta';
const FUSO = 'America/Sao_Paulo';
// Meio-dia em Brasília: longe da virada do dia.
const AGORA = '2026-10-28T15:00:00.000Z';
const DIA_MS = 86_400_000;

async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(
    `https://exemplo.test${caminho}`,
    { ...init, headers: { 'content-type': 'application/json', cookie: COOKIE, ...(init.headers ?? {}) } },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function criarUsuario(): Promise<void> {
  const agora = new Date().toISOString();
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(USER, 'pessoa@exemplo.com.br', 'Maria', agora)
    .run();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind('s-oferta', USER, new Date(Date.now() + DIA_MS).toISOString(), agora)
    .run();
}

/** Matrícula de quem está no dia `dia` da jornada em `agora`. */
async function noDia(dia: number, agora = AGORA): Promise<void> {
  const inicio = new Date(Date.parse(agora) - (dia - 1) * DIA_MS).toISOString();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO enrollments (user_id, program_id, started_at) VALUES (?, 'jornada-19', ?)",
  )
    .bind(USER, inicio)
    .run();
}

async function comPacote(produto: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entitlements (id, user_id, product_id, source, transaction_id, status, granted_at)
     VALUES (?, ?, ?, 'payt', ?, 'active', ?)`,
  )
    .bind(`e-${produto}`, USER, produto, `T-${produto}`, AGORA)
    .run();
}

const oferta = (agora = AGORA) => getOffer(env.DB, USER, FUSO, agora);

beforeEach(async () => {
  await prepararBanco();
  await criarUsuario();
});

describe('janelas da jornada', () => {
  it('sem matrícula, nada: desenhar a Home não é começar a jornada', async () => {
    expect(await oferta()).toBeNull();
  });

  it('dias 1 a 4, nada: a primeira impressão é a oração', async () => {
    for (const dia of [1, 2, 3, 4]) {
      await noDia(dia);
      expect(await oferta()).toBeNull();
    }
  });

  it('dias 5 a 9, o UP1', async () => {
    for (const dia of [5, 6, 9]) {
      await noDia(dia);
      expect(await oferta()).toMatchObject({ produto: 'oracao-sao-miguel', dia });
    }
  });

  it('dias 10 a 18, o UP2, com o aviso de saúde', async () => {
    for (const dia of [10, 14, 18]) {
      await noDia(dia);
      expect(await oferta()).toMatchObject({ produto: 'jornada-cura-padre-pio', dia });
    }
    expect((await oferta())?.aviso).toBe(
      'Conteúdo devocional. Não substitui acompanhamento médico nem tratamento.',
    );
  });

  it('dia 19 e depois, nada', async () => {
    await noDia(19);
    expect(await oferta()).toBeNull();
    // Passado o dia 19 o "dia de hoje" fica no 19, como no lembrete.
    await noDia(30);
    expect(await oferta()).toBeNull();
  });
});

describe('quem já tem o pacote', () => {
  it('com o UP1, não vê o UP1', async () => {
    await comPacote('oracao-sao-miguel');
    await noDia(6);
    expect(await oferta()).toBeNull();
  });

  it('com o UP2, não vê o UP2', async () => {
    await comPacote('jornada-cura-padre-pio');
    await noDia(12);
    expect(await oferta()).toBeNull();
  });

  it('com o UP1, ainda vê o UP2 na janela dele', async () => {
    await comPacote('oracao-sao-miguel');
    await noDia(12);
    expect(await oferta()).toMatchObject({ produto: 'jornada-cura-padre-pio' });
  });

  it('com os dois, card nenhum', async () => {
    await comPacote('oracao-sao-miguel');
    await comPacote('jornada-cura-padre-pio');
    for (const dia of [6, 12]) {
      await noDia(dia);
      expect(await oferta()).toBeNull();
    }
  });

  it('acesso revogado volta a ver a oferta', async () => {
    await comPacote('oracao-sao-miguel');
    await env.DB.prepare("UPDATE entitlements SET status = 'revoked'").run();
    await noDia(6);
    expect(await oferta()).toMatchObject({ produto: 'oracao-sao-miguel' });
  });
});

describe('"Agora não"', () => {
  it('esconde aquele pacote por 7 dias', async () => {
    await noDia(6);
    await registrarOfertaDispensada(env.DB, USER, 'oracao-sao-miguel', AGORA);
    expect(await oferta()).toBeNull();

    // Dentro dos 7 dias, ainda escondido (a matrícula anda junto com o relógio).
    const quase = new Date(Date.parse(AGORA) + 2 * DIA_MS).toISOString();
    await noDia(8, quase);
    expect(await oferta(quase)).toBeNull();
  });

  it('volta depois dos 7 dias, se ainda estiver na janela do pacote', async () => {
    await noDia(10);
    await registrarOfertaDispensada(env.DB, USER, 'jornada-cura-padre-pio', AGORA);
    const depois = new Date(Date.parse(AGORA) + (DIAS_DISPENSADA + 1) * DIA_MS).toISOString();
    await noDia(18, depois);
    expect(await oferta(depois)).toMatchObject({ produto: 'jornada-cura-padre-pio' });
  });

  it('dispensar um pacote não esconde o outro', async () => {
    await noDia(6);
    await registrarOfertaDispensada(env.DB, USER, 'oracao-sao-miguel', AGORA);
    const depois = new Date(Date.parse(AGORA) + 4 * DIA_MS).toISOString();
    await noDia(10, depois);
    expect(await oferta(depois)).toMatchObject({ produto: 'jornada-cura-padre-pio' });
  });
});

describe('rota da oferta', () => {
  it('exige sessão', async () => {
    expect((await chamar('/api/oferta', { headers: { cookie: '' } })).status).toBe(401);
  });

  it('uma oferta por vez, e offer_viewed uma vez por dia', async () => {
    await noDia(6, new Date().toISOString());

    const r1 = (await (await chamar('/api/oferta')).json()) as { oferta: Oferta };
    await chamar('/api/oferta');
    // Um objeto só, não uma lista.
    expect(r1.oferta).toMatchObject({ produto: 'oracao-sao-miguel', titulo: 'Oração de São Miguel do Monte Gargano' });

    const vistos = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE name = 'offer_viewed' AND user_id = ?",
    )
      .bind(USER)
      .first<{ n: number }>();
    expect(vistos?.n).toBe(1);
  });

  it('dispensar pela rota grava offer_dismissed e o card some', async () => {
    await noDia(6, new Date().toISOString());
    const res = await chamar('/api/oferta/dispensar', {
      method: 'POST',
      body: JSON.stringify({ produto: 'oracao-sao-miguel' }),
    });
    expect(res.status).toBe(200);
    expect(await (await chamar('/api/oferta')).json()).toEqual({ oferta: null });
  });

  it('dispensar pacote que não é ofertado é 400', async () => {
    const res = await chamar('/api/oferta/dispensar', {
      method: 'POST',
      body: JSON.stringify({ produto: 'jornada-meu-anjo' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('checkout vindo do card', () => {
  async function linkDeCompra(caminho: string): Promise<URL> {
    const { produto } = (await (await chamar(caminho)).json()) as { produto: { checkout_url: string } };
    return new URL(produto.checkout_url);
  }

  it('sai com utm_medium=home', async () => {
    const url = await linkDeCompra('/api/loja/oracao-sao-miguel?origem=home');
    expect(url.searchParams.get('utm_medium')).toBe('home');
    expect(url.searchParams.get('utm_source')).toBe('app');
  });

  it('pela Loja, continua utm_medium=loja; origem estranha também', async () => {
    expect((await linkDeCompra('/api/loja/oracao-sao-miguel')).searchParams.get('utm_medium')).toBe('loja');
    expect(
      (await linkDeCompra('/api/loja/oracao-sao-miguel?origem=qualquer')).searchParams.get('utm_medium'),
    ).toBe('loja');
  });
});
