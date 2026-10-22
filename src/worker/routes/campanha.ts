/**
 * Disparo de campanha e o link de "parar de receber".
 *
 * `POST /api/campanha/enviar` exige a chave no header, como o reprocesso. É
 * interino: na fase 11 o admin fica atrás do Cloudflare Access (§13) e estas
 * rotas saem daqui.
 *
 * `GET /parar` é público de propósito — o link vai num e-mail e precisa
 * funcionar sem login. Quem protege é a assinatura HMAC.
 */
import { Hono } from 'hono';
import { igualdadeSegura } from '../lib/cripto';
import { agoraIso } from '../lib/datas';
import type { AppBindings } from '../lib/types';
import { conferirAssinaturaParar, enviarCampanha } from '../services/campanhas';

function pagina(titulo: string, texto: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;background:#faf7f2;color:#141233;margin:0;
display:grid;place-items:center;min-height:100vh}main{max-width:32rem;padding:2rem;text-align:center}
h1{font-size:1.25rem}p{color:#2f2c73;line-height:1.6}</style></head>
<body><main><h1>${titulo}</h1><p>${texto}</p></main></body></html>`;
}

export const campanha = new Hono<AppBindings>().post('/enviar', async (c) => {
  const segredo = c.env.PAYT_INTEGRATION_KEY;
  const recebida = c.req.header('x-integration-key') ?? '';
  if (!segredo || !igualdadeSegura(recebida, segredo)) {
    return c.json({ error: 'integration_key_invalida' }, 401);
  }

  const corpo = (await c.req.json().catch(() => null)) as {
    campanha?: string;
    limite?: number;
    dry_run?: boolean;
    teste_para?: string;
  } | null;

  const nome = corpo?.campanha;
  const limite = Number(corpo?.limite ?? 0);
  if (!nome || !Number.isFinite(limite) || limite <= 0) {
    return c.json({ error: 'informe campanha e limite' }, 400);
  }

  try {
    const relatorio = await enviarCampanha(c.env, {
      campanha: nome,
      limite,
      dryRun: corpo?.dry_run === true,
      testePara: corpo?.teste_para ?? null,
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
      pagina('Link inválido', 'Este link não confere. Se quiser parar de receber, responda o e-mail.'),
      400,
    );
  }

  await c.env.DB.prepare(
    'UPDATE users SET marketing_opt_out_at = ? WHERE id = ? AND marketing_opt_out_at IS NULL',
  )
    .bind(agoraIso(), userId)
    .run();

  return c.html(
    pagina(
      'Pronto',
      'Você não vai mais receber avisos sobre o app. Os e-mails com o seu código de acesso continuam chegando normalmente.',
    ),
  );
});
