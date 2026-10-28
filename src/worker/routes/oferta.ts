/**
 * A oferta da Home (CLAUDE.md §9).
 *
 *   GET  /api/oferta            a oferta de agora, ou null; registra offer_viewed
 *   POST /api/oferta/dispensar  "Agora não": esconde o pacote por 7 dias
 *
 * O clique (offer_clicked) vai por /api/eventos, como o checkout_clicked: o
 * toque leva para outra tela, e o evento sai com keepalive.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { PacoteOfertado } from '../../shared/types';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';
import {
  getOffer,
  PACOTES_OFERTADOS,
  registrarOfertaDispensada,
  registrarOfertaVista,
} from '../services/offers';

const DispensarSchema = z.object({ produto: z.enum(PACOTES_OFERTADOS as [PacoteOfertado, ...PacoteOfertado[]]) });

async function fusoDe(db: D1Database, userId: string): Promise<string> {
  const u = await db
    .prepare('SELECT timezone FROM users WHERE id = ?')
    .bind(userId)
    .first<{ timezone: string | null }>();
  return u?.timezone || 'America/Sao_Paulo';
}

export const oferta = new Hono<AppBindings>()
  .get('/', async (c) => {
    const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
    if (!sessao) return c.json({ error: 'nao_autenticado' }, 401);

    const fuso = await fusoDe(c.env.DB, sessao.userId);
    const atual = await getOffer(c.env.DB, sessao.userId, fuso);
    if (atual) await registrarOfertaVista(c.env.DB, sessao.userId, atual, fuso);

    return c.json({ oferta: atual });
  })
  .post('/dispensar', async (c) => {
    const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
    if (!sessao) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = DispensarSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'pacote_invalido' }, 400);

    await registrarOfertaDispensada(c.env.DB, sessao.userId, corpo.data.produto);
    return c.json({ ok: true });
  });
