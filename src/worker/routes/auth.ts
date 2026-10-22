/**
 * Login por código (CLAUDE.md §8) e a sessão.
 *
 * `POST /api/auth/codigo`  pede o código por e-mail
 * `POST /api/auth/entrar`  troca o código por uma sessão
 * `POST /api/auth/sair`    encerra a sessão
 * `GET  /api/me`           quem está logado e a que tem acesso
 */
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  APP_NAME,
  CODIGO_DIGITOS,
  CODIGO_VALIDADE_MIN,
  SESSAO_DIAS,
} from '../../shared/constants';
import modeloCodigo from '../emails/codigo-login.md?raw';
import { renderizarEmail } from '../emails/render';
import type { AppBindings } from '../lib/types';
import {
  COOKIE_SESSAO,
  encerrarSessao,
  entrarComCodigo,
  normalizarEmail,
  pedirCodigo,
  usuarioDaSessao,
} from '../services/auth';
import { enviarEmail } from '../services/mail';

const PedirSchema = z.object({ email: z.string().trim().email().max(320) });

const EntrarSchema = z.object({
  email: z.string().trim().email().max(320),
  codigo: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${CODIGO_DIGITOS}}$`), `código de ${CODIGO_DIGITOS} dígitos`),
});

function ipDoPedido(c: { req: { header: (n: string) => string | undefined } }): string | null {
  return c.req.header('cf-connecting-ip') ?? null;
}

function gravarCookie(c: Context<AppBindings>, id: string) {
  setCookie(c, COOKIE_SESSAO, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSAO_DIAS * 24 * 60 * 60,
  });
}

export const auth = new Hono<AppBindings>()
  .post('/codigo', async (c) => {
    const corpo = PedirSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) {
      return c.json({ error: 'email_invalido' }, 400);
    }

    const pedido = await pedirCodigo(c.env.DB, corpo.data.email, ipDoPedido(c));

    if (pedido.codigo && pedido.userId) {
      const email = renderizarEmail(modeloCodigo, {
        codigo: pedido.codigo,
        app: APP_NAME,
        nome: pedido.nome ? `, ${pedido.nome.split(' ')[0]}` : '',
        validade: String(CODIGO_VALIDADE_MIN),
        suporte: c.env.SUPPORT_EMAIL ?? '',
      });

      await enviarEmail(
        c.env,
        'codigo_login',
        {
          para: normalizarEmail(corpo.data.email),
          assunto: email.assunto,
          texto: email.texto,
          html: email.html,
          ...(c.env.SUPPORT_EMAIL ? { responderPara: c.env.SUPPORT_EMAIL } : {}),
        },
        pedido.userId,
      );
    }

    // Mesma resposta para e-mail existente, inexistente ou acima do limite.
    return c.json({ ok: true, validade_min: CODIGO_VALIDADE_MIN });
  })

  .post('/entrar', async (c) => {
    const corpo = EntrarSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) {
      return c.json({ error: 'dados_invalidos' }, 400);
    }

    const r = await entrarComCodigo(c.env.DB, corpo.data.email, corpo.data.codigo);
    if (!r.ok) {
      return c.json({ error: r.motivo }, 401);
    }

    gravarCookie(c, r.sessionId);
    return c.json({ ok: true });
  })

  .post('/sair', async (c) => {
    await encerrarSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
    deleteCookie(c, COOKIE_SESSAO, { path: '/' });
    return c.json({ ok: true });
  });

export const me = new Hono<AppBindings>().get('/', async (c) => {
  const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
  if (!sessao) {
    return c.json({ error: 'nao_autenticado' }, 401);
  }

  const usuario = await c.env.DB.prepare(
    'SELECT id, email, name, timezone, prayer_hour FROM users WHERE id = ?',
  )
    .bind(sessao.userId)
    .first<{
      id: string;
      email: string | null;
      name: string | null;
      timezone: string;
      prayer_hour: number;
    }>();

  const { results: produtos } = await c.env.DB.prepare(
    `SELECT DISTINCT p.id, p.name, p.kind
       FROM entitlements e
       JOIN products p ON p.id = e.product_id
      WHERE e.user_id = ? AND e.status = 'active'
      ORDER BY p.sort`,
  )
    .bind(sessao.userId)
    .all<{ id: string; name: string; kind: string }>();

  return c.json({
    usuario: {
      id: usuario?.id,
      email: usuario?.email,
      nome: usuario?.name,
      timezone: usuario?.timezone,
      prayer_hour: usuario?.prayer_hour,
    },
    produtos,
    // O client usa isto para a tela de "nada liberado ainda" (§14: suporte visível).
    temAcesso: produtos.length > 0,
    suporte: c.env.SUPPORT_EMAIL ?? null,
  });
});
