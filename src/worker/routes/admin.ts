/**
 * Operações administrativas que precisam do banco (CLAUDE.md §13).
 * Interino, atrás da `ADMIN_API_KEY`; na fase 11 isto fica sob Cloudflare Access.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { chaveAdminConfere } from '../lib/admin';
import type { AppBindings } from '../lib/types';
import { concederEntitlement } from '../services/entitlements';
import { normalizarEmail } from '../services/auth';

const ConcederSchema = z.object({
  email: z.string().trim().email(),
  product_id: z.string().trim().min(1),
});

export const admin = new Hono<AppBindings>().post('/conceder', async (c) => {
  if (!chaveAdminConfere(c.req.header('x-admin-key'), c.env)) {
    return c.json({ error: 'nao_autorizado' }, 401);
  }

  const corpo = ConcederSchema.safeParse(await c.req.json().catch(() => null));
  if (!corpo.success) {
    return c.json({ error: 'informe email e product_id' }, 400);
  }

  const email = normalizarEmail(corpo.data.email);
  const usuario = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL',
  )
    .bind(email)
    .first<{ id: string }>();

  if (!usuario) return c.json({ error: 'usuario_nao_encontrado' }, 404);

  const produto = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?')
    .bind(corpo.data.product_id)
    .first<{ id: string; name: string }>();

  if (!produto) return c.json({ error: 'produto_nao_encontrado' }, 404);

  // source='manual' e sem transaction_id: reembolso da Payt não revoga isto.
  await concederEntitlement(c.env.DB, {
    userId: usuario.id,
    productId: produto.id,
    source: 'manual',
  });

  const linha = await c.env.DB.prepare(
    `SELECT status, granted_at FROM entitlements
      WHERE user_id = ? AND product_id = ? AND source = 'manual'`,
  )
    .bind(usuario.id, produto.id)
    .first<{ status: string; granted_at: string }>();

  return c.json({ ok: true, produto: produto.name, ...linha });
});
