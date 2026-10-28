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
import { montarAnuncio, type ModeloAnuncio } from '../emails/anuncio';
import { hmacHex } from '../lib/cripto';
import { agoraIso } from '../lib/datas';
import { segredo } from '../lib/segredos';
import type { AppBindings } from '../lib/types';
import { criarLinkDeAcesso } from './auth';
import { enviarEmail } from './mail';
import { PROVEDORES } from '../../shared/provedores';

type Ambiente = AppBindings['Bindings'];

/** Acima disto a campanha para sozinha. */
export const TETO_FALHA = 0.05;

/** Cota de envio da conta, por dia, compartilhada por todos os e-mails. */
export const COTA_DIARIA = 1000;
/**
 * Fatia reservada para transacional (código de login e boas-vindas). Campanha
 * nunca encosta nela: ficar sem cota de login deixaria cliente fora do app.
 */
export const RESERVA_TRANSACIONAL = 300;
/** Mínimo de envios antes de a taxa de falha valer alguma coisa. */
const AMOSTRA_MINIMA = 10;

export interface Destinatario {
  user_id: string;
  email: string;
  nome: string | null;
  produtos: string;
  /** Compra mais recente (ISO), para a ordem das ondas. */
  compra?: string | null;
}

export interface RelatorioCampanha {
  campanha: string;
  enviadosHoje: number;
  cotaRestante: number;
  enviados: number;
  falhas: number;
  pulados: number;
  taxaFalha: number;
  parouPorFalha: boolean;
  limite: number;
  ondaAnterior: number;
  dryRun: boolean;
  provedores: string[];
  modelo: ModeloAnuncio;
  erros: string[];
}

/** Link assinado: marca o opt-out sem exigir login. */
export async function linkParar(env: Ambiente, userId: string): Promise<string> {
  const chave = segredo(env, 'CAMPAIGN_SIGNING_KEY');
  if (!chave) throw new Error('CAMPAIGN_SIGNING_KEY não cadastrado');
  const assinatura = await hmacHex(chave, `parar:${userId}`);
  return `${env.APP_URL}/parar?u=${encodeURIComponent(userId)}&t=${assinatura}`;
}

export async function conferirAssinaturaParar(
  env: Ambiente,
  userId: string,
  token: string,
): Promise<boolean> {
  const chave = segredo(env, 'CAMPAIGN_SIGNING_KEY');
  if (!chave) return false;
  return (await hmacHex(chave, `parar:${userId}`)) === token;
}

/** Quantos e-mails já saíram hoje (qualquer tipo), para a cota da conta. */
export async function enviadosHoje(db: D1Database): Promise<number> {
  const inicioDoDia = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'email_enviado' AND created_at >= ?")
    .bind(inicioDoDia)
    .first<{ n: number }>();
  return r?.n ?? 0;
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
 * Monta a prioridade por provedor. Os domínios vão como parâmetro; só a posição
 * do CASE é interpolada, e ela vem de chave validada contra o PROVEDORES.
 */
function ordemPorProvedor(provedores: string[]): { sql: string; valores: string[] } {
  const desconhecidos = provedores.filter((p) => !(p in PROVEDORES));
  if (desconhecidos.length > 0) {
    throw new Error(
      `provedor desconhecido: ${desconhecidos.join(', ')}. ` +
        `Conhecidos: ${Object.keys(PROVEDORES).join(', ')}.`,
    );
  }
  // Vazio não vira `0`: inteiro solto no ORDER BY do SQLite é índice de coluna,
  // não constante, e `ORDER BY 0` é erro de intervalo.
  if (provedores.length === 0) return { sql: '', valores: [] };

  const dominio = "lower(substr(u.email, instr(u.email, '@') + 1))";
  const valores: string[] = [];
  const casos = provedores.map((p, i) => {
    const dominios = PROVEDORES[p] ?? [];
    valores.push(...dominios);
    return `WHEN ${dominio} IN (${dominios.map(() => '?').join(',')}) THEN ${i}`;
  });

  // Quem não está na lista vai para o fim, sem sair da seleção.
  return { sql: `CASE ${casos.join(' ')} ELSE ${provedores.length} END`, valores };
}

/**
 * Quem ainda não recebeu: tem e-mail, não optou por sair, tem pelo menos um
 * produto ativo e não está em `campaign_sends`.
 *
 * A ordem é **compra mais recente primeiro** — quem comprou ontem lembra da
 * marca e reclama menos de receber — e, se vier `provedores`, o provedor manda
 * na ordem e a data desempata dentro de cada um.
 */
export async function destinatarios(
  db: D1Database,
  campanha: string,
  limite: number,
  provedores: string[] = [],
): Promise<Destinatario[]> {
  const ordem = ordemPorProvedor(provedores);

  const { results } = await db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name AS nome,
              (SELECT GROUP_CONCAT(p.name, '|')
                 FROM entitlements e JOIN products p ON p.id = e.product_id
                WHERE e.user_id = u.id AND e.status = 'active') AS produtos,
              (SELECT MAX(e.granted_at)
                 FROM entitlements e
                WHERE e.user_id = u.id AND e.status = 'active') AS compra
         FROM users u
        WHERE u.deleted_at IS NULL
          AND u.email IS NOT NULL
          AND u.marketing_opt_out_at IS NULL
          AND EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM campaign_sends c WHERE c.campaign = ? AND c.user_id = u.id)
        ORDER BY ${ordem.sql ? `${ordem.sql}, ` : ''}compra DESC, u.created_at DESC
        LIMIT ?`,
    )
    .bind(campanha, ...ordem.valores, limite)
    .all<Destinatario>();

  return results;
}

async function registrar(
  db: D1Database,
  campanha: string,
  userId: string,
  status: 'sent' | 'failed',
  erro: string | null,
  modelo: ModeloAnuncio,
): Promise<void> {
  // O modelo fica gravado para comparar depois; a chave continua sendo só
  // (campanha, usuário), e quem recebeu um modelo nunca recebe o outro.
  await db
    .prepare(
      `INSERT INTO campaign_sends (campaign, user_id, status, error, sent_at, model)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign, user_id) DO UPDATE SET
         status = excluded.status, error = excluded.error, sent_at = excluded.sent_at,
         model = excluded.model`,
    )
    .bind(campanha, userId, status, erro, agoraIso(), modelo)
    .run();
}

/**
 * Link do e-mail de anúncio. É um link que **já entra** (§8): a base é de
 * compradores antigos, e pedir e-mail e código a quem tem 60 anos para ver uma
 * novidade que ele não pediu é onde a campanha se perde.
 *
 * No envio de teste para um endereço que não é de usuário não há a quem prender
 * o token, então sobra o caminho antigo: a tela de login com o e-mail preenchido.
 */
async function linkDeAcesso(env: Ambiente, d: Destinatario, dryRun: boolean): Promise<string> {
  if (d.user_id === 'teste') {
    return `${env.APP_URL}/entrar?e=${encodeURIComponent(d.email)}`;
  }
  // Dry-run não grava token: ele serve para conferir seleção e texto, e um
  // token que nunca vai num e-mail só sujaria a tabela.
  if (dryRun) return `${env.APP_URL}/acesso?t=dry-run`;
  return `${env.APP_URL}/acesso?t=${await criarLinkDeAcesso(env.DB, d.user_id)}`;
}

export interface OpcoesEnvio {
  campanha: string;
  limite: number;
  dryRun: boolean;
  /** Manda tudo para este endereço, sem tocar na base. */
  testePara?: string | null;
  /** Provedores na frente da fila, na ordem dada (ver PROVEDORES). */
  provedores?: string[];
  /** Qual texto do anúncio vai (emails/anuncio.ts). Sem isto, o completo. */
  modelo?: ModeloAnuncio;
}

export async function enviarCampanha(
  env: Ambiente,
  opcoes: OpcoesEnvio,
): Promise<RelatorioCampanha> {
  const { campanha, limite, dryRun } = opcoes;
  const modelo = opcoes.modelo ?? 'padrao';
  const anterior = await ondaAnterior(env.DB, campanha);
  const erros: string[] = [];

  // Onda só pode dobrar. Domínio novo que dispara 1.000 de uma vez vira spam.
  const tetoOnda = anterior === 0 ? limite : anterior * 2;

  // E a cota do dia é da conta inteira: o que sobra para campanha é o total
  // menos o que já saiu hoje menos a reserva do transacional.
  const jaHoje = await enviadosHoje(env.DB);
  const tetoCota = COTA_DIARIA - RESERVA_TRANSACIONAL - jaHoje;

  const teto = Math.min(tetoOnda, tetoCota);
  if (limite > teto) {
    throw new Error(
      `limite ${limite} acima do máximo agora, que é ${Math.max(teto, 0)}. ` +
        `Onda anterior: ${anterior} (teto ${tetoOnda}). ` +
        `Cota do dia: ${COTA_DIARIA} no total, ${jaHoje} já enviado(s), ` +
        `${RESERVA_TRANSACIONAL} reservado(s) para login e boas-vindas (teto ${tetoCota}).`,
    );
  }

  /*
   * Em modo teste a mensagem sai para um endereço só e nada é gravado. Se esse
   * endereço for de um usuário que existe, usamos os dados dele: assim o e-mail
   * de teste tem a lista de produtos de verdade e um link de parar que funciona
   * — que é justamente o que se quer conferir antes de disparar para a base.
   */
  const lista = opcoes.testePara
    ? [
        (await env.DB.prepare(
          `SELECT u.id AS user_id, u.email, u.name AS nome,
                  (SELECT GROUP_CONCAT(p.name, '|')
                     FROM entitlements e JOIN products p ON p.id = e.product_id
                    WHERE e.user_id = u.id AND e.status = 'active') AS produtos
             FROM users u WHERE u.email = ? AND u.deleted_at IS NULL`,
        )
          .bind(opcoes.testePara.trim().toLowerCase())
          .first<Destinatario>()) ?? {
          user_id: 'teste',
          email: opcoes.testePara,
          nome: 'Teste',
          produtos: 'Jornada com São Miguel',
        },
      ]
    : await destinatarios(env.DB, campanha, limite, opcoes.provedores ?? []);

  let enviados = 0;
  let falhas = 0;
  let parouPorFalha = false;

  for (const d of lista) {
    const primeiro = d.nome?.trim().split(' ')[0] ?? '';
    const variaveis = {
      // Vazio quando não sabemos o nome: a saudação vira "Olá!" (ver emails/anuncio.ts).
      primeiro_nome: primeiro,
      link_acesso: await linkDeAcesso(env, d, dryRun),
      lista_produtos: (d.produtos ?? '')
        .split('|')
        .filter(Boolean)
        .map((n) => `- ${n}`)
        .join('\n'),
      // Usuário de verdade ganha link assinado, mesmo em teste.
      link_parar:
        d.user_id === 'teste' ? `${env.APP_URL}/parar?u=teste&t=invalido` : await linkParar(env, d.user_id),
      email_suporte: env.SUPPORT_EMAIL ?? '',
    };

    const corpo = montarAnuncio(variaveis, modelo);

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
      await registrar(env.DB, campanha, d.user_id, r.ok ? 'sent' : 'failed', r.erro ?? null, modelo);
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
    // Dry-run não manda nada, então não debita a cota do dia.
    enviadosHoje: jaHoje + (dryRun ? 0 : enviados),
    cotaRestante: Math.max(COTA_DIARIA - jaHoje - (dryRun ? 0 : enviados), 0),
    enviados,
    falhas,
    pulados: lista.length - feitos,
    taxaFalha: feitos === 0 ? 0 : falhas / feitos,
    parouPorFalha,
    limite,
    ondaAnterior: anterior,
    dryRun,
    provedores: opcoes.provedores ?? [],
    modelo,
    erros: erros.slice(0, 20),
  };
}
