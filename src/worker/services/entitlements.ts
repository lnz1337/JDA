/**
 * Quem pode ver o quê (CLAUDE.md §6). Uma função decide: `hasAccess`.
 * Toda rota de conteúdo (`/api/lessons/:id`, `/media/*`) passa por aqui.
 */
import { agoraIso, somarDias } from '../lib/datas';
import { novoId } from '../lib/ids';

/** Dias de carência depois do vencimento, para assinatura em atraso (§6). */
const CARENCIA_DIAS = 3;

export type OrigemEntitlement = 'payt' | 'manual';

export interface ConcederParams {
  userId: string;
  productId: string;
  source: OrigemEntitlement;
  transactionId?: string | null;
}

interface LinhaAssinatura {
  status: string;
  next_charge_at: string | null;
}

/**
 * Concede acesso. Idempotente por (user, produto, transação): o mesmo postback
 * reprocessado não cria linha nova, e um produto re-comprado depois de reembolso
 * volta para 'active'.
 */
export async function concederEntitlement(db: D1Database, p: ConcederParams): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, transaction_id, status, granted_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)
       ON CONFLICT (user_id, product_id, transaction_id) DO UPDATE SET
         status = 'active',
         revoked_at = NULL,
         source = excluded.source`,
    )
    .bind(novoId(), p.userId, p.productId, p.source, p.transactionId ?? null, agoraIso())
    .run();
}

/** Revoga tudo que veio de uma transação (reembolso, chargeback). */
export async function revogarPorTransacao(db: D1Database, transactionId: string): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE entitlements
          SET status = 'revoked', revoked_at = ?
        WHERE transaction_id = ? AND status = 'active'`,
    )
    .bind(agoraIso(), transactionId)
    .run();

  return r.meta.changes ?? 0;
}

/**
 * Assinatura vale enquanto (§6):
 *   - status active/pending; ou
 *   - overdue dentro da carência de 3 dias depois de next_charge_at; ou
 *   - cancelada, mas dentro do período já pago.
 */
export function assinaturaValida(
  assinatura: LinhaAssinatura | null,
  agora = agoraIso(),
): boolean {
  if (!assinatura) return false;

  const { status, next_charge_at: proxima } = assinatura;
  if (status === 'active' || status === 'pending') return true;

  if (status === 'overdue') {
    const limite = somarDias(proxima, CARENCIA_DIAS);
    return limite !== null && agora < limite;
  }

  if (status.startsWith('canceled')) {
    return proxima !== null && agora < proxima;
  }

  return false;
}

/** A assinatura mais recente do usuário, ou null. */
export async function assinaturaDoUsuario(
  db: D1Database,
  userId: string,
): Promise<LinhaAssinatura | null> {
  return db
    .prepare(
      `SELECT status, next_charge_at
         FROM subscriptions
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .bind(userId)
    .first<LinhaAssinatura>();
}

/**
 * hasAccess = entitlement do produto
 *          OU entitlement de um bundle que contém o produto
 *          OU (produto incluso no Círculo E assinatura válida).
 */
export async function hasAccess(
  db: D1Database,
  userId: string,
  productId: string,
): Promise<boolean> {
  const direto = await db
    .prepare(
      `SELECT 1
         FROM entitlements e
        WHERE e.user_id = ?
          AND e.status = 'active'
          AND (
            e.product_id = ?
            OR e.product_id IN (SELECT bundle_id FROM bundle_items WHERE product_id = ?)
          )
        LIMIT 1`,
    )
    .bind(userId, productId, productId)
    .first();

  if (direto) return true;

  const produto = await db
    .prepare('SELECT requires_subscription FROM products WHERE id = ?')
    .bind(productId)
    .first<{ requires_subscription: number }>();

  if (!produto || produto.requires_subscription !== 1) return false;

  return assinaturaValida(await assinaturaDoUsuario(db, userId));
}
