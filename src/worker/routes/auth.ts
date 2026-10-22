/**
 * Login por código, link de acesso direto e a sessão (CLAUDE.md §8).
 *
 * `POST /api/auth/codigo`    pede o código por e-mail
 * `POST /api/auth/entrar`    troca o código por uma sessão
 * `POST /api/auth/sair`      encerra a sessão
 * `GET  /acesso?t=...`       link do e-mail: já entra e manda para a Home
 * `GET  /api/me`             quem está logado e a que tem acesso
 * `POST /api/me/confirmar`   pede o código de uma ação sensível
 * `POST /api/me/email`       troca o e-mail (pede código)
 * `POST /api/me/excluir`     exclui a conta (pede código)
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
import modeloAcao from '../emails/codigo-acao.md?raw';
import modeloCodigo from '../emails/codigo-login.md?raw';
import { renderizarEmail } from '../emails/render';
import type { AppBindings } from '../lib/types';
import {
  ACOES_SENSIVEIS,
  type AcaoSensivel,
  COOKIE_SESSAO,
  conferirCodigo,
  consumirCodigo,
  encerrarSessao,
  entrarComCodigo,
  entrarComLink,
  normalizarEmail,
  pedirCodigo,
  pedirCodigoDeAcao,
  usuarioDaSessao,
} from '../services/auth';
import { excluirConta, trocarEmail } from '../services/conta';
import { enviarEmail } from '../services/mail';

const PedirSchema = z.object({ email: z.string().trim().email().max(320) });

const CodigoSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${CODIGO_DIGITOS}}$`), `código de ${CODIGO_DIGITOS} dígitos`);

const EntrarSchema = z.object({
  email: z.string().trim().email().max(320),
  codigo: CodigoSchema,
});

const ConfirmarSchema = z.object({ acao: z.enum(ACOES_SENSIVEIS) });
const ExcluirSchema = z.object({ codigo: CodigoSchema });
const TrocarEmailSchema = z.object({
  codigo: CodigoSchema,
  email: z.string().trim().email().max(320),
});

/** Como cada ação se chama no e-mail. */
const FRASES: Record<AcaoSensivel, { curta: string; frase: string }> = {
  excluir_conta: { curta: 'excluir a sua conta', frase: 'excluir a sua conta' },
  trocar_email: { curta: 'trocar o seu e-mail', frase: 'trocar o e-mail da sua conta' },
};

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

function primeiroNome(nome: string | null | undefined): string {
  const p = nome?.trim().split(' ')[0];
  return p ? `, ${p}` : '';
}

export const auth = new Hono<AppBindings>()
  .post('/codigo', async (c) => {
    const corpo = PedirSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) {
      return c.json({ error: 'email_invalido' }, 400);
    }

    const pedido = await pedirCodigo(c.env.DB, corpo.data.email, ipDoPedido(c));

    if (pedido.codigo && pedido.userId) {
      const email = renderizarEmail(
        modeloCodigo,
        {
          codigo: pedido.codigo,
          app: APP_NAME,
          nome: primeiroNome(pedido.nome),
          digitos: String(CODIGO_DIGITOS),
          validade: String(CODIGO_VALIDADE_MIN),
          suporte: c.env.SUPPORT_EMAIL ?? '',
        },
        { motivo: 'Você recebeu este e-mail porque pediu um código para entrar no app.' },
      );

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

/**
 * O link que o e-mail leva. Não é rota de API: devolve um redirecionamento,
 * porque quem clica é uma pessoa no navegador.
 *
 * Deu certo, vai para a Home já logado. Não deu, vai para a tela de login com o
 * e-mail preenchido e o motivo — nunca uma página de erro.
 */
export const acesso = new Hono<AppBindings>().get('/', async (c) => {
  const r = await entrarComLink(c.env.DB, c.req.query('t') ?? '');

  if (!r.ok) {
    const params = new URLSearchParams({ motivo: r.motivo });
    if (r.email) params.set('e', r.email);
    return c.redirect(`/entrar?${params.toString()}`, 302);
  }

  gravarCookie(c, r.sessionId);
  return c.redirect('/', 302);
});

async function exigirSessao(c: Context<AppBindings>): Promise<string | null> {
  const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
  return sessao?.userId ?? null;
}

export const me = new Hono<AppBindings>()
  .get('/', async (c) => {
    const userId = await exigirSessao(c);
    if (!userId) {
      return c.json({ error: 'nao_autenticado' }, 401);
    }

    const usuario = await c.env.DB.prepare(
      'SELECT id, email, name, timezone, prayer_hour FROM users WHERE id = ?',
    )
      .bind(userId)
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
      .bind(userId)
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
  })

  /** Manda o código que autoriza uma ação sensível, para o e-mail atual da conta. */
  .post('/confirmar', async (c) => {
    const userId = await exigirSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = ConfirmarSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'acao_invalida' }, 400);

    const pedido = await pedirCodigoDeAcao(c.env.DB, userId, corpo.data.acao, ipDoPedido(c));
    if (!pedido.ok) {
      return c.json({ error: pedido.motivo, suporte: c.env.SUPPORT_EMAIL ?? null }, 400);
    }

    const frases = FRASES[corpo.data.acao];
    const email = renderizarEmail(
      modeloAcao,
      {
        codigo: pedido.codigo,
        app: APP_NAME,
        nome: primeiroNome(pedido.nome),
        acao_curta: frases.curta,
        acao_frase: frases.frase,
        digitos: String(CODIGO_DIGITOS),
        validade: String(CODIGO_VALIDADE_MIN),
        suporte: c.env.SUPPORT_EMAIL ?? '',
      },
      { motivo: `Você recebeu este e-mail porque pediu para ${frases.frase} no app.` },
    );

    await enviarEmail(
      c.env,
      `codigo_${corpo.data.acao}`,
      {
        para: pedido.email,
        assunto: email.assunto,
        texto: email.texto,
        html: email.html,
        ...(c.env.SUPPORT_EMAIL ? { responderPara: c.env.SUPPORT_EMAIL } : {}),
      },
      userId,
    );

    return c.json({ ok: true, validade_min: CODIGO_VALIDADE_MIN });
  })

  .post('/email', async (c) => {
    const userId = await exigirSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = TrocarEmailSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'dados_invalidos' }, 400);

    const conferida = await conferirCodigo(c.env.DB, userId, 'trocar_email', corpo.data.codigo);
    if (!conferida.ok) return c.json({ error: conferida.motivo }, 401);

    const r = await trocarEmail(c.env.DB, userId, corpo.data.email);
    // E-mail em uso não gasta o código: a pessoa corrige e tenta outra vez.
    if (!r.ok) return c.json({ error: r.motivo }, 409);

    await consumirCodigo(c.env.DB, conferida.codigoId);
    return c.json({ ok: true, email: normalizarEmail(corpo.data.email) });
  })

  .post('/excluir', async (c) => {
    const userId = await exigirSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const corpo = ExcluirSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'dados_invalidos' }, 400);

    const conferida = await conferirCodigo(c.env.DB, userId, 'excluir_conta', corpo.data.codigo);
    if (!conferida.ok) return c.json({ error: conferida.motivo }, 401);

    // A exclusão apaga os códigos junto, então não há o que consumir depois.
    await excluirConta(c.env.DB, userId);
    deleteCookie(c, COOKIE_SESSAO, { path: '/' });

    return c.json({ ok: true });
  });
