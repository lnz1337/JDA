/**
 * Assinatura de push do aparelho (CLAUDE.md §11).
 *
 * `GET    /api/push/chave`       chave pública VAPID, para o `subscribe`
 * `POST   /api/push/assinatura`  grava a assinatura deste aparelho
 * `DELETE /api/push/assinatura`  tira a assinatura deste aparelho
 * `POST   /api/push/confirmacao` push de teste logo após escolher o horário
 */
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { agoraIso, horaLocal } from '../lib/datas';
import { novoId } from '../lib/ids';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';
import {
  assinaturasDoUsuario,
  chavePublicaVapid,
  enviarERegistrar,
  servicoDoEndpoint,
} from '../services/push';

const AssinaturaSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  p256dh: z.string().trim().min(16).max(200),
  auth: z.string().trim().min(8).max(100),
});

const RemoverSchema = z.object({ endpoint: z.string().trim().url().max(2000) });

const ConfirmacaoSchema = z.object({ hora: z.number().int().min(0).max(23) });

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

    // Pelo serviço, não direto do env: é lá que BOM e espaço saem do segredo.
    const chave = chavePublicaVapid(c.env);
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

  /**
   * Push de confirmação, logo depois de a pessoa escolher o horário.
   *
   * Vale o envio imediato porque é ele que prova a corrente inteira — permissão,
   * assinatura, serviço de push e service worker — **enquanto a pessoa ainda
   * está na tela**. Descobrir amanhã às 7h que não funciona é descobrir sozinho.
   */
  .post('/confirmacao', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = ConfirmacaoSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'dados_invalidos' }, 400);

    const usuario = await c.env.DB.prepare('SELECT timezone FROM users WHERE id = ?')
      .bind(userId)
      .first<{ timezone: string }>();

    const assinaturas = await assinaturasDoUsuario(c.env.DB, userId);
    if (assinaturas.length === 0) return c.json({ error: 'sem_assinatura' }, 404);

    // Se a hora de hoje já passou no fuso da pessoa, o próximo lembrete é amanhã
    // — dizer "hoje" seria prometer algo que não vai acontecer.
    const agora = horaLocal(usuario?.timezone ?? 'America/Sao_Paulo');
    const quando = corpo.data.hora > agora ? 'Hoje' : 'Amanhã';

    let algumFoi = false;
    /** A última falha, para a tela ter o que mostrar em staging. */
    let falha: { status?: number; erro: string } | null = null;
    for (const assinatura of assinaturas) {
      const r = await enviarERegistrar(
        c.env,
        userId,
        assinatura,
        {
          titulo: 'Pronto!',
          corpo: `${quando} às ${corpo.data.hora}h eu te lembro da oração do dia.`,
          url: '/?origem=push',
          tag: 'confirmacao',
        },
        { tipo: 'confirmacao' },
      );
      if (r.ok) algumFoi = true;
      else falha = { status: r.status, erro: r.erro };
    }

    if (!algumFoi) {
      /*
       * O status e o motivo do serviço de push voltam no corpo. Um 403
       * `BadJwtToken` da Apple é configuração do `VAPID_SUBJECT`, não aparelho
       * com problema, e sem isso a tela só podia dizer "não consegui". O motivo
       * já vem sem URL de `enviarPush`: endpoint não é dado de relatório (§11).
       */
      return c.json(
        { error: 'envio_falhou', status: falha?.status, detalhe: falha?.erro },
        502,
      );
    }
    return c.json({ ok: true, quando: quando.toLowerCase() });
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
