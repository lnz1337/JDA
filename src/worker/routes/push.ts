/**
 * Assinatura de push do aparelho (CLAUDE.md §11).
 *
 * `GET /api/push/chave`  chave pública VAPID, para o `subscribe` do navegador
 */
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';

async function userIdDaSessao(c: Context<AppBindings>): Promise<string | null> {
  const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
  return sessao?.userId ?? null;
}

export const push = new Hono<AppBindings>()
  /**
   * A chave pública não é segredo — ela vai para dentro do `subscribe` de todo
   * navegador. Fica atrás de sessão mesmo assim, porque não há motivo para
   * entregá-la a quem não entrou.
   */
  .get('/chave', async (c) => {
    if (!(await userIdDaSessao(c))) return c.json({ error: 'nao_autenticado' }, 401);

    const chave = c.env.VAPID_PUBLIC_KEY;
    if (!chave) return c.json({ error: 'push_indisponivel' }, 503);

    return c.json({ chave });
  });
