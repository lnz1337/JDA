/**
 * Login por código de 6 dígitos no e-mail (CLAUDE.md §8).
 *
 * Decisões que importam:
 * - a resposta de "pedir código" é **sempre a mesma**, exista o e-mail ou não:
 *   senão o endpoint vira um verificador de quem é cliente;
 * - o código é guardado com hash (sha256 do código + id do usuário), nunca em
 *   claro, e some do processo assim que o e-mail sai;
 * - limite por e-mail **e** por IP, porque limitar só por e-mail deixa alguém
 *   varrer uma lista, e limitar só por IP não protege um e-mail específico.
 */
import {
  CODIGO_DIGITOS,
  CODIGO_MAX_POR_HORA,
  CODIGO_MAX_TENTATIVAS,
  CODIGO_VALIDADE_MIN,
  LINK_ACESSO_DIAS,
  SESSAO_DIAS,
} from '../../shared/constants';
import { sha256Hex, tokenAleatorio } from '../lib/cripto';
import { agoraIso, somarDias } from '../lib/datas';
import { novoId } from '../lib/ids';

export const COOKIE_SESSAO = 'sessao';

/** Ações que pedem código mesmo com sessão aberta (§8). */
export const ACOES_SENSIVEIS = ['excluir_conta', 'trocar_email'] as const;
export type AcaoSensivel = (typeof ACOES_SENSIVEIS)[number];

/** `login` abre sessão; o resto só autoriza uma ação de quem já está dentro. */
type Proposito = 'login' | AcaoSensivel;

export interface PedidoDeCodigo {
  /** Sempre true para quem chama: não revela se o e-mail existe. */
  aceito: boolean;
  /** Preenchidos só quando há código novo para enviar. */
  codigo?: string;
  userId?: string;
  nome?: string | null;
  motivo?: 'limite_por_email' | 'limite_por_ip' | 'email_desconhecido';
}

function codigoNovo(): string {
  const max = 10 ** CODIGO_DIGITOS;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(n % max).padStart(CODIGO_DIGITOS, '0');
}

/** O hash inclui o id do usuário: o mesmo código para outro usuário não casa. */
function hashDoCodigo(codigo: string, userId: string): Promise<string> {
  return sha256Hex(`${codigo}|${userId}`);
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function pedidosNaUltimaHora(
  db: D1Database,
  coluna: 'user_id' | 'ip',
  valor: string,
): Promise<number> {
  const limite = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM login_codes WHERE ${coluna} = ? AND created_at > ?`)
    .bind(valor, limite)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Cria um código para o e-mail, se ele existir e os limites permitirem.
 * Quem chama envia o e-mail; este serviço não conhece provedor.
 */
export async function pedirCodigo(
  db: D1Database,
  email: string,
  ip: string | null,
): Promise<PedidoDeCodigo> {
  const normalizado = normalizarEmail(email);

  if (ip && (await pedidosNaUltimaHora(db, 'ip', ip)) >= CODIGO_MAX_POR_HORA) {
    return { aceito: true, motivo: 'limite_por_ip' };
  }

  const usuario = await db
    .prepare('SELECT id, name FROM users WHERE email = ? AND deleted_at IS NULL')
    .bind(normalizado)
    .first<{ id: string; name: string | null }>();

  if (!usuario) {
    return { aceito: true, motivo: 'email_desconhecido' };
  }

  if ((await pedidosNaUltimaHora(db, 'user_id', usuario.id)) >= CODIGO_MAX_POR_HORA) {
    return { aceito: true, motivo: 'limite_por_email' };
  }

  const codigo = await gravarCodigo(db, usuario.id, 'login', ip);
  return { aceito: true, codigo, userId: usuario.id, nome: usuario.name };
}

/** Sorteia, grava com hash e devolve o código em claro para quem vai enviar. */
async function gravarCodigo(
  db: D1Database,
  userId: string,
  proposito: Proposito,
  ip: string | null,
): Promise<string> {
  const codigo = codigoNovo();

  await db
    .prepare(
      `INSERT INTO login_codes (id, user_id, code_hash, purpose, expires_at, attempts, created_at, ip)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      novoId(),
      userId,
      await hashDoCodigo(codigo, userId),
      proposito,
      new Date(Date.now() + CODIGO_VALIDADE_MIN * 60 * 1000).toISOString(),
      agoraIso(),
      ip,
    )
    .run();

  return codigo;
}

export type ResultadoEntrada =
  | { ok: true; sessionId: string; userId: string; expiraEm: string }
  | { ok: false; motivo: 'codigo_invalido' | 'tentativas_esgotadas' };

/** Confere o código e abre a sessão. */
export async function entrarComCodigo(
  db: D1Database,
  email: string,
  codigo: string,
): Promise<ResultadoEntrada> {
  const normalizado = normalizarEmail(email);

  const usuario = await db
    .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
    .bind(normalizado)
    .first<{ id: string }>();

  // Sem usuário a resposta é a mesma de código errado: nada vaza daqui.
  if (!usuario) return { ok: false, motivo: 'codigo_invalido' };

  const conferida = await conferirCodigo(db, usuario.id, 'login', codigo);
  if (!conferida.ok) return conferida;

  await consumirCodigo(db, conferida.codigoId);
  const { sessionId, expiraEm } = await abrirSessao(db, usuario.id);

  return { ok: true, sessionId, userId: usuario.id, expiraEm };
}

export type CodigoConferido =
  | { ok: true; codigoId: string }
  | { ok: false; motivo: 'codigo_invalido' | 'tentativas_esgotadas' };

/**
 * Confere o código do propósito pedido **sem consumi-lo**: quem chama marca como
 * usado depois de a ação dar certo, para um erro posterior (e-mail já em uso,
 * por exemplo) não obrigar a pessoa a pedir outro código.
 *
 * O propósito separa os códigos: o de login não autoriza excluir a conta, e o de
 * exclusão não abre sessão.
 */
export async function conferirCodigo(
  db: D1Database,
  userId: string,
  proposito: Proposito,
  codigo: string,
): Promise<CodigoConferido> {
  const linha = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM login_codes
        WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, proposito, agoraIso())
    .first<{ id: string; code_hash: string; attempts: number }>();

  if (!linha) return { ok: false, motivo: 'codigo_invalido' };

  if (linha.attempts >= CODIGO_MAX_TENTATIVAS) {
    return { ok: false, motivo: 'tentativas_esgotadas' };
  }

  const esperado = await hashDoCodigo(codigo.trim(), userId);
  if (esperado !== linha.code_hash) {
    await db
      .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(linha.id)
      .run();
    return { ok: false, motivo: 'codigo_invalido' };
  }

  return { ok: true, codigoId: linha.id };
}

export async function consumirCodigo(db: D1Database, codigoId: string): Promise<void> {
  await db
    .prepare('UPDATE login_codes SET used_at = ? WHERE id = ?')
    .bind(agoraIso(), codigoId)
    .run();
}

async function abrirSessao(
  db: D1Database,
  userId: string,
): Promise<{ sessionId: string; expiraEm: string }> {
  const agora = agoraIso();
  const sessionId = novoId();
  const expiraEm = somarDias(agora, SESSAO_DIAS) ?? agora;

  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, userId, expiraEm, agora)
    .run();

  return { sessionId, expiraEm };
}

export type PedidoDeAcao =
  | { ok: true; codigo: string; email: string; nome: string | null }
  | { ok: false; motivo: 'sem_email' | 'limite' };

/**
 * Código para confirmar uma ação sensível. Vai para o e-mail **atual** da conta,
 * não para um novo: é o acesso àquela caixa que prova que é a pessoa. Mandar
 * para o endereço novo deixaria quem pegasse um celular destravado levar a conta
 * inteira para outro e-mail.
 */
export async function pedirCodigoDeAcao(
  db: D1Database,
  userId: string,
  acao: AcaoSensivel,
  ip: string | null,
): Promise<PedidoDeAcao> {
  const usuario = await db
    .prepare('SELECT email, name FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId)
    .first<{ email: string | null; name: string | null }>();

  // Conta sem e-mail (fake_email, §8) não tem para onde mandar: é caso de suporte.
  if (!usuario?.email) return { ok: false, motivo: 'sem_email' };

  if ((await pedidosNaUltimaHora(db, 'user_id', userId)) >= CODIGO_MAX_POR_HORA) {
    return { ok: false, motivo: 'limite' };
  }

  const codigo = await gravarCodigo(db, userId, acao, ip);
  return { ok: true, codigo, email: usuario.email, nome: usuario.name };
}

/** Token do link de acesso direto. Devolve o token em claro, que só vai no e-mail. */
export async function criarLinkDeAcesso(db: D1Database, userId: string): Promise<string> {
  const token = tokenAleatorio();
  const agora = agoraIso();

  await db
    .prepare(
      `INSERT INTO access_links (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      novoId(),
      userId,
      await sha256Hex(token),
      somarDias(agora, LINK_ACESSO_DIAS) ?? agora,
      agora,
    )
    .run();

  return token;
}

export type ResultadoLink =
  | { ok: true; sessionId: string; userId: string }
  | {
      ok: false;
      motivo: 'link_invalido' | 'link_usado' | 'link_expirado';
      /** Para a tela de login já vir com o campo preenchido. */
      email?: string | null;
    };

/** Entra pelo link do e-mail: uso único, preso ao usuário, vence em 7 dias. */
export async function entrarComLink(db: D1Database, token: string): Promise<ResultadoLink> {
  if (!token) return { ok: false, motivo: 'link_invalido' };

  const linha = await db
    .prepare(
      `SELECT l.id, l.user_id, l.used_at, l.expires_at, u.email, u.deleted_at
         FROM access_links l JOIN users u ON u.id = l.user_id
        WHERE l.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<{
      id: string;
      user_id: string;
      used_at: string | null;
      expires_at: string;
      email: string | null;
      deleted_at: string | null;
    }>();

  // Token que não existe e conta excluída dão a mesma resposta, sem e-mail: não
  // é link para preencher tela de login nenhuma.
  if (!linha || linha.deleted_at) return { ok: false, motivo: 'link_invalido' };
  if (linha.used_at) return { ok: false, motivo: 'link_usado', email: linha.email };
  if (linha.expires_at <= agoraIso()) {
    return { ok: false, motivo: 'link_expirado', email: linha.email };
  }

  /*
   * Marcar como usado é o que decide quem entrou: o UPDATE condicional é a
   * reivindicação do token. Dois cliques ao mesmo tempo — e o leitor de links do
   * Outlook abrindo o link antes da pessoa — fariam duas sessões se a checagem
   * acima bastasse.
   */
  const reivindicado = await db
    .prepare('UPDATE access_links SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .bind(agoraIso(), linha.id)
    .run();

  if (reivindicado.meta.changes !== 1) {
    return { ok: false, motivo: 'link_usado', email: linha.email };
  }

  const { sessionId } = await abrirSessao(db, linha.user_id);
  return { ok: true, sessionId, userId: linha.user_id };
}

/** Sessão válida, com renovação a cada uso (§8). */
export async function usuarioDaSessao(
  db: D1Database,
  sessionId: string | undefined,
): Promise<{ userId: string } | null> {
  if (!sessionId) return null;
  const agora = agoraIso();

  const sessao = await db
    .prepare(
      `SELECT s.user_id FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    )
    .bind(sessionId, agora)
    .first<{ user_id: string }>();

  if (!sessao) return null;

  await db
    .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    .bind(somarDias(agora, SESSAO_DIAS), sessionId)
    .run();

  return { userId: sessao.user_id };
}

export async function encerrarSessao(db: D1Database, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}
