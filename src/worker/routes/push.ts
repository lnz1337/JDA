/**
 * Assinatura de push do aparelho (CLAUDE.md §11).
 *
 * `GET    /api/push/chave`       chave pública VAPID, para o `subscribe`
 * `POST   /api/push/assinatura`  grava a assinatura deste aparelho
 * `DELETE /api/push/assinatura`  tira a assinatura deste aparelho
 */
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';
import { servicoDoEndpoint } from '../services/push';

const AssinaturaSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  p256dh: z.string().trim().min(16).max(200),
  auth: z.string().trim().min(8).max(100),
});

const RemoverSchema = z.object({ endpoint: z.string().trim().url().max(2000) });

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
  })

  .post('/assinatura', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = AssinaturaSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'assinatura_invalida' }, 400);

    if (!servicoDoEndpoint(corpo.data.endpoint)) {
      return c.json({ error: 'endpoint_nao_aceito' }, 400);
    }

    /*
     * O endpoint é único por aparelho. Se ele já estava em outra conta, é o
     * mesmo celular trocando de usuário — a assinatura passa para quem está
     * logado agora, senão o lembrete continuaria indo para a conta antiga.
     */
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         created_at = excluded.created_at,
         last_success_at = NULL`,
    )
      .bind(novoId(), userId, corpo.data.endpoint, corpo.data.p256dh, corpo.data.auth, agoraIso())
      .run();

    return c.json({ ok: true });
  })

  .delete('/assinatura', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = RemoverSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'dados_invalidos' }, 400);

    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    )
      .bind(corpo.data.endpoint, userId)
      .run();

    return c.json({ ok: true });
  });
