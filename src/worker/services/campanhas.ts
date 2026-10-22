/**
 * Campanha de e-mail para a base (CLAUDE.md §14).
 *
 * Cuidados que o código impõe, não a disciplina de quem roda:
 * - uma linha por campanha e usuário (`campaign_sends`): nunca reenvia e retoma
 *   de onde parou se cair no meio;
 * - quem optou por não receber sai da seleção — mas continua recebendo código de
 *   login e e-mail de compra, que são transacionais;
 * - ondas: o domínio é novo, então o script recusa um limite maior que o dobro
 *   da onda anterior e para sozinho se a taxa de falha passar de 5%.
 */
import { montarAnuncio } from '../emails/anuncio';
import { hmacHex } from '../lib/cripto';
import { agoraIso } from '../lib/datas';
import type { AppBindings } from '../lib/types';
import { enviarEmail } from './mail';

type Ambiente = AppBindings['Bindings'];

/** Acima disto a campanha para sozinha. */
export const TETO_FALHA = 0.05;
/** Mínimo de envios antes de a taxa de falha valer alguma coisa. */
const AMOSTRA_MINIMA = 10;

export interface Destinatario {
  user_id: string;
  email: string;
  nome: string | null;
  produtos: string;
}

export interface RelatorioCampanha {
  campanha: string;
  enviados: number;
  falhas: number;
  pulados: number;
  taxaFalha: number;
  parouPorFalha: boolean;
  limite: number;
  ondaAnterior: number;
  dryRun: boolean;
  erros: string[];
}

/** Link assinado: marca o opt-out sem exigir login. */
export async function linkParar(env: Ambiente, userId: string): Promise<string> {
  const segredo = env.CAMPAIGN_SIGNING_KEY;
  if (!segredo) throw new Error('CAMPAIGN_SIGNING_KEY não cadastrado');
  const assinatura = await hmacHex(segredo, `parar:${userId}`);
  return `${env.APP_URL}/parar?u=${encodeURIComponent(userId)}&t=${assinatura}`;
}

export async function conferirAssinaturaParar(
  env: Ambiente,
  userId: string,
  token: string,
): Promise<boolean> {
  const segredo = env.CAMPAIGN_SIGNING_KEY;
  if (!segredo) return false;
  return (await hmacHex(segredo, `parar:${userId}`)) === token;
}

/** Quanto a última onda desta campanha enviou. */
export async function ondaAnterior(db: D1Database, campanha: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM campaign_sends WHERE campaign = ? AND status = 'sent'")
    .bind(campanha)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Quem ainda não recebeu: tem e-mail, não optou por sair, tem pelo menos um
 * produto ativo e não está em `campaign_sends`.
 */
export async function destinatarios(
  db: D1Database,
  campanha: string,
  limite: number,
): Promise<Destinatario[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name AS nome,
              (SELECT GROUP_CONCAT(p.name, '|')
                 FROM entitlements e JOIN products p ON p.id = e.product_id
                WHERE e.user_id = u.id AND e.status = 'active') AS produtos
         FROM users u
        WHERE u.deleted_at IS NULL
          AND u.email IS NOT NULL
          AND u.marketing_opt_out_at IS NULL
          AND EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM campaign_sends c WHERE c.campaign = ? AND c.user_id = u.id)
        ORDER BY u.created_at
        LIMIT ?`,
    )
    .bind(campanha, limite)
    .all<Destinatario>();

  return results;
}

async function registrar(
  db: D1Database,
  campanha: string,
  userId: string,
  status: 'sent' | 'failed',
  erro: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, error, sent_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (campaign, user_id) DO UPDATE SET
         status = excluded.status, error = excluded.error, sent_at = excluded.sent_at`,
    )
    .bind(campanha, userId, status, erro, agoraIso())
    .run();
}

export interface OpcoesEnvio {
  campanha: string;
  limite: number;
  dryRun: boolean;
  /** Manda tudo para este endereço, sem tocar na base. */
  testePara?: string | null;
}

export async function enviarCampanha(
  env: Ambiente,
  opcoes: OpcoesEnvio,
): Promise<RelatorioCampanha> {
  const { campanha, limite, dryRun } = opcoes;
  const anterior = await ondaAnterior(env.DB, campanha);
  const erros: string[] = [];

  // Onda só pode dobrar. Domínio novo que dispara 1.000 de uma vez vira spam.
  const teto = anterior === 0 ? limite : anterior * 2;
  if (limite > teto) {
    throw new Error(
      `limite ${limite} passa do dobro da onda anterior (${anterior}). Máximo agora: ${teto}.`,
    );
  }

  const lista = opcoes.testePara
    ? [
        {
          user_id: 'teste',
          email: opcoes.testePara,
          nome: 'Teste',
          produtos: 'Jornada com São Miguel',
        },
      ]
    : await destinatarios(env.DB, campanha, limite);

  let enviados = 0;
  let falhas = 0;
  let parouPorFalha = false;

  for (const d of lista) {
    const primeiro = d.nome?.trim().split(' ')[0] ?? '';
    const variaveis = {
      primeiro_nome: primeiro || 'Olá',
      link_acesso: `${env.APP_URL}/entrar?e=${encodeURIComponent(d.email)}`,
      lista_produtos: (d.produtos ?? '')
        .split('|')
        .filter(Boolean)
        .map((n) => `- ${n}`)
        .join('\n'),
      link_parar: opcoes.testePara ? `${env.APP_URL}/parar?u=teste&t=teste` : await linkParar(env, d.user_id),
      email_suporte: env.SUPPORT_EMAIL ?? '',
    };

    const corpo = montarAnuncio(variaveis);

    if (dryRun) {
      enviados += 1;
      continue;
    }

    const r = await enviarEmail(
      env,
      'campanha_anuncio',
      {
        para: d.email,
        assunto: corpo.assunto,
        texto: corpo.texto,
        html: corpo.html,
        ...(env.SUPPORT_EMAIL ? { responderPara: env.SUPPORT_EMAIL } : {}),
      },
      opcoes.testePara ? null : d.user_id,
    );

    if (r.ok) enviados += 1;
    else {
      falhas += 1;
      erros.push(`${d.user_id}: ${r.erro ?? 'falha'}`);
    }

    if (!opcoes.testePara) {
      await registrar(env.DB, campanha, d.user_id, r.ok ? 'sent' : 'failed', r.erro ?? null);
    }

    const feitos = enviados + falhas;
    if (feitos >= AMOSTRA_MINIMA && falhas / feitos > TETO_FALHA) {
      parouPorFalha = true;
      console.error('[campanha] parando: taxa de falha', falhas, '/', feitos);
      break;
    }
  }

  const feitos = enviados + falhas;
  return {
    campanha,
    enviados,
    falhas,
    pulados: lista.length - feitos,
    taxaFalha: feitos === 0 ? 0 : falhas / feitos,
    parouPorFalha,
    limite,
    ondaAnterior: anterior,
    dryRun,
    erros: erros.slice(0, 20),
  };
}
