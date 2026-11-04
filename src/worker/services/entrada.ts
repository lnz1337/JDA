/**
 * Entrada sem código: pelo celular ou pelo e-mail da compra (CLAUDE.md §8,
 * docs/entrada-sem-codigo.md).
 *
 * O código de 6 números era o que mais barrava o público mais velho: sair do
 * app, achar o e-mail em Promoções ou no Spam, decorar seis números, voltar. O
 * que a pessoa sabe de cabeça, e que a Payt pede no checkout, é o celular.
 *
 * O que segura o risco de entrar sabendo o celular de outra pessoa: trocar o
 * e-mail e excluir a conta continuam pedindo código (services/auth.ts), e o app
 * nunca mostra o e-mail nem o telefone completos. O que segura quem quer testar
 * uma lista de números: o limite por IP e por identificador, abaixo.
 */
import { sha256Hex } from '../lib/cripto';
import { agoraIso, somarDias } from '../lib/datas';
import { novoId } from '../lib/ids';
import { abrirSessao, normalizarEmail } from './auth';

/** Tentativas por hora, por IP e por identificador. */
export const TENTATIVAS_POR_HORA = 10;

export type MetodoDeEntrada = 'celular' | 'email';

export type ResultadoDaEntrada =
  | { ok: true; sessionId: string; userId: string; metodo: MetodoDeEntrada }
  | {
      ok: false;
      motivo: 'nao_encontrado' | 'varios' | 'limite' | 'invalido';
      metodo: MetodoDeEntrada;
    };

/**
 * A chave de comparação do celular: **DDD + os 8 últimos dígitos**.
 *
 * Só dígitos; o `55` da frente sai quando sobram 12 ou 13. Comparar os 8
 * últimos casa o número com e sem o 9 da frente, que convivem na base (a Payt
 * guarda como a pessoa digitou). Sem DDD não dá para saber de quem é.
 */
export function chaveDoCelular(valor: string | null | undefined): string | null {
  let d = (valor ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return `${d.slice(0, 2)}${d.slice(-8)}`;
}

async function tentativasNaUltimaHora(
  db: D1Database,
  chave: string,
  agora: string,
): Promise<number> {
  const desde = new Date(Date.parse(agora) - 60 * 60 * 1000).toISOString();
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM login_tentativas WHERE chave = ? AND created_at > ?')
    .bind(chave, desde)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Conta a tentativa **antes** de procurar: quem testa uma lista paga o limite
 * por cada número, achando ou não. Limpa o que passou de um dia, para a tabela
 * não crescer sem fim.
 */
async function registrarTentativa(
  db: D1Database,
  chaves: string[],
  agora: string,
): Promise<boolean> {
  const passou = await Promise.all(chaves.map((c) => tentativasNaUltimaHora(db, c, agora)));
  if (passou.some((n) => n >= TENTATIVAS_POR_HORA)) return false;

  await db.batch([
    ...chaves.map((c) =>
      db
        .prepare('INSERT INTO login_tentativas (id, chave, created_at) VALUES (?, ?, ?)')
        .bind(novoId(), c, agora),
    ),
    db
      .prepare('DELETE FROM login_tentativas WHERE created_at < ?')
      .bind(somarDias(agora, -1) ?? agora),
  ]);
  return true;
}

/** Quem tem este celular, entre as contas não excluídas. */
async function usuariosDoCelular(db: D1Database, chave: string): Promise<string[]> {
  // O LIKE pelos 8 últimos estreita; a chave completa (com o DDD) decide.
  const { results } = await db
    .prepare('SELECT id, phone FROM users WHERE deleted_at IS NULL AND phone LIKE ?')
    .bind(`%${chave.slice(-8)}`)
    .all<{ id: string; phone: string }>();
  return results.filter((u) => chaveDoCelular(u.phone) === chave).map((u) => u.id);
}

export async function entrarSemCodigo(
  db: D1Database,
  dados: { email?: string; celular?: string },
  ip: string | null,
  agora = agoraIso(),
): Promise<ResultadoDaEntrada> {
  const metodo: MetodoDeEntrada = dados.celular !== undefined ? 'celular' : 'email';

  const identificador =
    metodo === 'celular' ? chaveDoCelular(dados.celular) : normalizarEmail(dados.email ?? '');
  if (!identificador) return { ok: false, motivo: 'invalido', metodo };

  const chaves = [
    `id:${await sha256Hex(`${metodo}:${identificador}`)}`,
    ...(ip ? [`ip:${ip}`] : []),
  ];
  if (!(await registrarTentativa(db, chaves, agora)))
    return { ok: false, motivo: 'limite', metodo };

  let ids: string[];
  if (metodo === 'celular') {
    ids = await usuariosDoCelular(db, identificador);
  } else {
    const u = await db
      .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
      .bind(identificador)
      .first<{ id: string }>();
    ids = u ? [u.id] : [];
  }

  if (ids.length === 0) return { ok: false, motivo: 'nao_encontrado', metodo };
  // Família que comprou com o mesmo número: o app não escolhe pela pessoa.
  if (ids.length > 1) return { ok: false, motivo: 'varios', metodo };

  const userId = ids[0]!;
  const { sessionId } = await abrirSessao(db, userId);
  return { ok: true, sessionId, userId, metodo };
}
