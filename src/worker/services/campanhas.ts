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
import { agoraIso, somarDias } from '../lib/datas';
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
  /** Maior volume de e-mail do domínio num dia, nos 14 dias antes de hoje. */
  maiorDia: number;
  /** Quanto o domínio pode mandar hoje: o dobro do maior dia, com piso. */
  tetoDoDia: number;
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


/**
 * A trava de volume é **do domínio, por dia**, não da campanha (§14).
 *
 * Quem o Gmail e o Outlook avaliam é o domínio de envio, não a campanha: um
 * lembrete que começasse do zero não seria um domínio novo. Até 04/11 a trava
 * contava por campanha, pelo total acumulado, e campanha nova — com 0 — não
 * tinha teto nenhum além da cota.
 *
 * O teto de hoje é **o dobro do maior dia dos últimos 14**, contando todo
 * `email_enviado` (campanha, login e boas-vindas). Hoje fica de fora da conta do
 * maior dia: senão cada lote enviado subiria o teto do próprio dia. Em vez
 * disso, **o que já saiu hoje conta contra o teto**, e várias chamadas no mesmo
 * dia somam. Os 14 dias fazem o teto baixar sozinho depois de uma pausa,
 * porque a reputação também esfria. Sem histórico, vale o piso da primeira onda.
 */
export const DIAS_DO_HISTORICO = 14;
export const PISO_DA_ONDA = 50;

export async function volumeDoDominio(
  db: D1Database,
  agora = agoraIso(),
): Promise<{ maiorDia: number; hoje: number; tetoDoDia: number }> {
  const inicioDeHoje = `${agora.slice(0, 10)}T00:00:00.000Z`;
  const inicioDoHistorico = somarDias(inicioDeHoje, -DIAS_DO_HISTORICO) ?? inicioDeHoje;

  const r = await db
    .prepare(
      `SELECT COALESCE(MAX(n), 0) AS maior FROM (
         SELECT COUNT(*) AS n FROM events
          WHERE name = 'email_enviado' AND created_at >= ? AND created_at < ?
          GROUP BY substr(created_at, 1, 10))`,
    )
    .bind(inicioDoHistorico, inicioDeHoje)
    .first<{ maior: number }>();
  const hoje = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'email_enviado' AND created_at >= ?")
    .bind(inicioDeHoje)
    .first<{ n: number }>();

  const maiorDia = r?.maior ?? 0;
  return { maiorDia, hoje: hoje?.n ?? 0, tetoDoDia: Math.max(PISO_DA_ONDA, maiorDia * 2) };
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
/*
 * Quem já recebeu o e-mail de boas-vindas fica de fora: comprou depois que o
 * postback entrou no ar e já ganhou o link de acesso. O anúncio seria a mesma
 * mensagem duas vezes — aconteceu com 8 dos 50 da primeira onda (28/10). Só o
 * envio que deu certo conta: boas-vindas que falhou deixa a pessoa sem link, e
 * aí o anúncio é justamente o que ela precisa.
 */
/**
 * As campanhas que existem, com os textos que cada uma aceita (o primeiro é o
 * padrão) e quem ela alcança além da regra comum.
 *
 * Campanha desconhecida é recusada: nome digitado errado viraria uma campanha
 * nova, com `campaign_sends` vazio, e mandaria para a base inteira de novo.
 */
export const CAMPANHAS = {
  'anuncio-app': { modelos: ['padrao', 'curto'] },
  'lembrete-app': { modelos: ['lembrete'] },
} as const satisfies Record<string, { modelos: readonly ModeloAnuncio[] }>;

export type NomeCampanha = keyof typeof CAMPANHAS;

export function ehCampanha(valor: string): valor is NomeCampanha {
  return Object.hasOwn(CAMPANHAS, valor);
}

/** Dias entre o anúncio e o lembrete: o link do anúncio já venceu (§8, 7 dias). */
export const DIAS_ATE_O_LEMBRETE = 7;

/**
 * O que cada campanha acrescenta à seleção comum.
 *
 * - `anuncio-app`: fora quem já recebeu as boas-vindas (abaixo).
 * - `lembrete-app`: só quem recebeu o anúncio há pelo menos 7 dias e **nunca
 *   entrou** — nenhum link de acesso usado, nenhum código de login usado,
 *   nenhuma sessão. A sessão sozinha não basta: "Sair do app" apaga a linha, e
 *   quem entrou e saiu não pode receber "você ainda não entrou".
 */
function filtroDaCampanha(campanha: NomeCampanha, agora: string): { sql: string; valores: string[] } {
  if (campanha === 'lembrete-app') {
    return {
      sql: `AND EXISTS (
                SELECT 1 FROM campaign_sends a
                 WHERE a.campaign = 'anuncio-app' AND a.user_id = u.id
                   AND a.status = 'sent' AND a.sent_at <= ?)
          AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM access_links l WHERE l.user_id = u.id AND l.used_at IS NOT NULL)
          AND NOT EXISTS (
                SELECT 1 FROM login_codes c
                 WHERE c.user_id = u.id AND c.purpose = 'login' AND c.used_at IS NOT NULL)`,
      valores: [somarDias(agora, -DIAS_ATE_O_LEMBRETE) ?? agora],
    };
  }
  return {
    sql: `AND NOT EXISTS (
                SELECT 1 FROM events x
                 WHERE x.user_id = u.id AND x.name = 'email_enviado'
                   AND json_extract(x.props_json, '$.tipo') = 'boas_vindas')`,
    valores: [],
  };
}

export async function destinatarios(
  db: D1Database,
  campanha: NomeCampanha,
  limite: number,
  provedores: string[] = [],
  agora = agoraIso(),
): Promise<Destinatario[]> {
  const ordem = ordemPorProvedor(provedores);
  const filtro = filtroDaCampanha(campanha, agora);

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
          ${filtro.sql}
        ORDER BY ${ordem.sql ? `${ordem.sql}, ` : ''}compra DESC, u.created_at DESC
        LIMIT ?`,
    )
    .bind(campanha, ...filtro.valores, ...ordem.valores, limite)
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
  /** Qual texto vai (emails/anuncio.ts). Sem isto, o primeiro da campanha. */
  modelo?: ModeloAnuncio;
}

export async function enviarCampanha(
  env: Ambiente,
  opcoes: OpcoesEnvio,
): Promise<RelatorioCampanha> {
  const { limite, dryRun } = opcoes;
  const campanha = opcoes.campanha;
  if (!ehCampanha(campanha)) {
    throw new Error(`campanha desconhecida: ${campanha}. Vale: ${Object.keys(CAMPANHAS).join(', ')}`);
  }
  const aceitos: readonly ModeloAnuncio[] = CAMPANHAS[campanha].modelos;
  const modelo = opcoes.modelo ?? aceitos[0]!;
  if (!aceitos.includes(modelo)) {
    throw new Error(`a campanha ${campanha} não usa o modelo ${modelo}. Vale: ${aceitos.join(', ')}`);
  }
  const erros: string[] = [];

  // Volume só pode dobrar, e quem conta é o domínio, não a campanha. Domínio
  // novo que dispara 1.000 de uma vez vira spam.
  const volume = await volumeDoDominio(env.DB);
  const jaHoje = volume.hoje;
  const tetoVolume = volume.tetoDoDia - jaHoje;

  // E a cota do dia é da conta inteira: o que sobra para campanha é o total
  // menos o que já saiu hoje menos a reserva do transacional.
  const tetoCota = COTA_DIARIA - RESERVA_TRANSACIONAL - jaHoje;

  const teto = Math.min(tetoVolume, tetoCota);
  if (limite > teto) {
    throw new Error(
      `limite ${limite} acima do máximo agora, que é ${Math.max(teto, 0)}. ` +
        `Volume do domínio: maior dia dos últimos ${DIAS_DO_HISTORICO} = ${volume.maiorDia}, ` +
        `teto do dia ${volume.tetoDoDia}, ${jaHoje} já enviado(s) hoje (sobram ${Math.max(tetoVolume, 0)}). ` +
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
    maiorDia: volume.maiorDia,
    tetoDoDia: volume.tetoDoDia,
    dryRun,
    provedores: opcoes.provedores ?? [],
    modelo,
    erros: erros.slice(0, 20),
  };
}
