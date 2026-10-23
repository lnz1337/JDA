/**
 * Operações administrativas que precisam do banco (CLAUDE.md §13).
 * Interino, atrás da `ADMIN_API_KEY`; na fase 11 isto fica sob Cloudflare Access.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { chaveAdminConfere } from '../lib/admin';
import type { AppBindings } from '../lib/types';
import { normalizarEmail } from '../services/auth';
import { excluirConta } from '../services/conta';
import {
  assinaturaDoUsuario,
  assinaturaValida,
  concederEntitlement,
} from '../services/entitlements';

const ConcederSchema = z.object({
  email: z.string().trim().email(),
  product_id: z.string().trim().min(1),
});

const ExcluirSchema = z.object({
  email: z.string().trim().email(),
  /** Sem isto, a rota só mostra o que seria apagado. */
  confirmar: z.boolean().optional(),
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
})

  /**
   * Exclusão de conta pedida pelo suporte (§14). Até a tela de Perfil existir
   * (fase 7), é por aqui que a pessoa exerce o direito de exclusão.
   *
   * **Mostra antes de apagar.** Sem `confirmar: true` a rota só devolve o que
   * seria apagado. A exclusão anonimiza e não tem volta, e um e-mail digitado
   * errado apaga a conta de outra pessoa — o passo a mais custa um comando e
   * evita um estrago que não dá para desfazer.
   */
  .post('/excluir-conta', async (c) => {
    if (!chaveAdminConfere(c.req.header('x-admin-key'), c.env)) {
      return c.json({ error: 'nao_autorizado' }, 401);
    }

    const corpo = ExcluirSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'informe email' }, 400);

    const email = normalizarEmail(corpo.data.email);
    const usuario = await c.env.DB.prepare(
      'SELECT id, name FROM users WHERE email = ? AND deleted_at IS NULL',
    )
      .bind(email)
      .first<{ id: string; name: string | null }>();

    if (!usuario) return c.json({ error: 'usuario_nao_encontrado' }, 404);

    const { results: produtos } = await c.env.DB.prepare(
      `SELECT p.name FROM entitlements e JOIN products p ON p.id = e.product_id
        WHERE e.user_id = ? AND e.status = 'active' ORDER BY p.sort`,
    )
      .bind(usuario.id)
      .all<{ name: string }>();

    const assinatura = await assinaturaDoUsuario(c.env.DB, usuario.id);

    const resumo = {
      email,
      nome: usuario.name,
      produtos: produtos.map((p) => p.name),
      assinatura: assinatura
        ? { status: assinatura.status, proxima_cobranca: assinatura.next_charge_at }
        : null,
      /*
       * Excluir a conta **não cancela a assinatura na Payt**: a cobrança
       * continua e a pessoa fica pagando por um acesso que não existe mais.
       * Cancelar é no painel da Payt, antes. (A tela do Perfil avisa isso na
       * fase 7; aqui o aviso vai no relatório para quem roda o script.)
       */
      assinatura_ativa: assinaturaValida(assinatura),
    };

    if (corpo.data.confirmar !== true) {
      return c.json({ ok: true, previa: true, ...resumo });
    }

    await excluirConta(c.env.DB, usuario.id);
    return c.json({ ok: true, excluido: true, ...resumo });
  });
