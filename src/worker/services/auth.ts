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
  SESSAO_DIAS,
} from '../../shared/constants';
import { sha256Hex } from '../lib/cripto';
import { agoraIso, somarDias } from '../lib/datas';
import { novoId } from '../lib/ids';

export const COOKIE_SESSAO = 'sessao';

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

  const codigo = codigoNovo();
  const agora = agoraIso();

  await db
    .prepare(
      `INSERT INTO login_codes (id, user_id, code_hash, expires_at, attempts, created_at, ip)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      novoId(),
      usuario.id,
      await hashDoCodigo(codigo, usuario.id),
      new Date(Date.now() + CODIGO_VALIDADE_MIN * 60 * 1000).toISOString(),
      agora,
      ip,
    )
    .run();

  return { aceito: true, codigo, userId: usuario.id, nome: usuario.name };
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
  const agora = agoraIso();

  const usuario = await db
    .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
    .bind(normalizado)
    .first<{ id: string }>();

  // Sem usuário a resposta é a mesma de código errado: nada vaza daqui.
  if (!usuario) return { ok: false, motivo: 'codigo_invalido' };

  const linha = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM login_codes
        WHERE user_id = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(usuario.id, agora)
    .first<{ id: string; code_hash: string; attempts: number }>();

  if (!linha) return { ok: false, motivo: 'codigo_invalido' };

  if (linha.attempts >= CODIGO_MAX_TENTATIVAS) {
    return { ok: false, motivo: 'tentativas_esgotadas' };
  }

  const esperado = await hashDoCodigo(codigo.trim(), usuario.id);
  if (esperado !== linha.code_hash) {
    await db
      .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(linha.id)
      .run();
    return { ok: false, motivo: 'codigo_invalido' };
  }

  await db.prepare('UPDATE login_codes SET used_at = ? WHERE id = ?').bind(agora, linha.id).run();

  const sessionId = novoId();
  const expiraEm = somarDias(agora, SESSAO_DIAS) ?? agora;
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, usuario.id, expiraEm, agora)
    .run();

  return { ok: true, sessionId, userId: usuario.id, expiraEm };
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
