/**
 * Disparo de campanha e o link de "parar de receber".
 *
 * `POST /api/campanha/enviar` exige a `ADMIN_API_KEY` no header `x-admin-key`,
 * como o reprocesso. É interino: na fase 11 o admin fica atrás do Cloudflare
 * Access (§13) e estas rotas saem daqui.
 *
 * `GET /parar` é público de propósito — o link vai num e-mail e precisa
 * funcionar sem login. Quem protege é a assinatura HMAC.
 */
import { Hono } from 'hono';
import { chaveAdminConfere } from '../lib/admin';
import { agoraIso } from '../lib/datas';
import { pagina } from '../lib/pagina';
import type { AppBindings } from '../lib/types';
import { conferirAssinaturaParar, enviarCampanha } from '../services/campanhas';

/** Mesma moldura da tela do link de acesso (`lib/pagina.ts`). */
const paginaDeTexto = (titulo: string, texto: string) => pagina(titulo, `<p>${texto}</p>`);

export const campanha = new Hono<AppBindings>().post('/enviar', async (c) => {
  if (!chaveAdminConfere(c.req.header('x-admin-key'), c.env)) {
    return c.json({ error: 'nao_autorizado' }, 401);
  }

  const corpo = (await c.req.json().catch(() => null)) as {
    campanha?: string;
    limite?: number;
    dry_run?: boolean;
    teste_para?: string;
    provedores?: string[];
  } | null;

  const nome = corpo?.campanha;
  const limite = Number(corpo?.limite ?? 0);
  if (!nome || !Number.isFinite(limite) || limite <= 0) {
    return c.json({ error: 'informe campanha e limite' }, 400);
  }

  const provedores = (Array.isArray(corpo?.provedores) ? corpo.provedores : [])
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);

  try {
    const relatorio = await enviarCampanha(c.env, {
      campanha: nome,
      limite,
      dryRun: corpo?.dry_run === true,
      testePara: corpo?.teste_para ?? null,
      provedores,
    });
    return c.json({ ok: true, ...relatorio });
  } catch (erro) {
    return c.json({ ok: false, error: erro instanceof Error ? erro.message : String(erro) }, 400);
  }
});

export const parar = new Hono<AppBindings>().get('/', async (c) => {
  const userId = c.req.query('u') ?? '';
  const token = c.req.query('t') ?? '';

  if (!userId || !token || !(await conferirAssinaturaParar(c.env, userId, token))) {
    return c.html(
      paginaDeTexto('Link inválido', 'Este link não confere. Se quiser parar de receber, responda o e-mail.'),
      400,
    );
  }

  await c.env.DB.prepare(
    'UPDATE users SET marketing_opt_out_at = ? WHERE id = ? AND marketing_opt_out_at IS NULL',
  )
    .bind(agoraIso(), userId)
    .run();

  return c.html(
    paginaDeTexto(
      'Pronto',
      'Você não vai mais receber avisos sobre o app. Os e-mails com o seu código de acesso continuam chegando normalmente.',
    ),
  );
});
