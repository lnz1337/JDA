/**
 * Operações administrativas que precisam do banco (CLAUDE.md §13).
 * Interino, atrás da `ADMIN_API_KEY`; na fase 11 isto fica sob Cloudflare Access.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { chaveAdminConfere } from '../lib/admin';
import type { AppBindings } from '../lib/types';
import { APP_NAME } from '../../shared/constants';
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import { normalizarEmail } from '../services/auth';
import { enviarBoasVindas } from '../services/boas-vindas';
import { excluirConta } from '../services/conta';
import { assinaturasDoUsuario, enviarERegistrar } from '../services/push';
import { diagnosticoVapid } from '../services/vapid-diagnostico';
import {
  assinaturaDoUsuario,
  assinaturaValida,
  concederEntitlement,
} from '../services/entitlements';

const ConcederSchema = z.object({
  email: z.string().trim().email(),
  product_id: z.string().trim().min(1),
  /** Cria a conta se o e-mail ainda não existir. Sem isto, e-mail novo é 404. */
  criar_usuario: z.boolean().optional(),
  nome: z.string().trim().max(120).optional(),
  /** Manda o e-mail de boas-vindas com o link que já entra (§8). */
  enviar_acesso: z.boolean().optional(),
});

const PushTesteSchema = z.object({
  email: z.string().trim().email(),
  titulo: z.string().trim().max(80).optional(),
  corpo: z.string().trim().max(200).optional(),
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

  // O produto antes da conta: produto digitado errado não pode deixar para trás
  // uma conta criada sem acesso a nada.
  const produto = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?')
    .bind(corpo.data.product_id)
    .first<{ id: string; name: string }>();

  if (!produto) return c.json({ error: 'produto_nao_encontrado' }, 404);

  /*
   * Criar é opt-in. Para o suporte, e-mail que não existe quase sempre é e-mail
   * digitado errado ou compra feita com outro endereço — criar sem pedir faria
   * uma conta nova em vez de achar a certa.
   */
  let userId = usuario?.id;
  const criado = !userId;
  if (!userId) {
    if (!corpo.data.criar_usuario) return c.json({ error: 'usuario_nao_encontrado' }, 404);
    userId = novoId();
    await c.env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(userId, email, corpo.data.nome ?? null, agoraIso())
      .run();
  }

  // source='manual' e sem transaction_id: reembolso da Payt não revoga isto.
  await concederEntitlement(c.env.DB, {
    userId,
    productId: produto.id,
    source: 'manual',
  });

  const linha = await c.env.DB.prepare(
    `SELECT status, granted_at FROM entitlements
      WHERE user_id = ? AND product_id = ? AND source = 'manual'`,
  )
    .bind(userId, produto.id)
    .first<{ status: string; granted_at: string }>();

  const envio = corpo.data.enviar_acesso
    ? await enviarBoasVindas(c.env, {
        userId,
        email,
        nome: corpo.data.nome,
        motivo: `Você recebeu este e-mail porque o suporte da ${APP_NAME} liberou o seu acesso.`,
      })
    : null;

  return c.json({
    ok: true,
    produto: produto.name,
    usuario_criado: criado,
    ...linha,
    ...(envio ? { email_enviado: envio.ok, ...(envio.ok ? {} : { erro_email: envio.erro }) } : {}),
  });
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
  })

  /**
   * Push de teste para os aparelhos de alguém. Serve para o suporte conferir a
   * corrente inteira — VAPID, assinatura, serviço de push e service worker —
   * sem esperar a hora do lembrete chegar.
   */
  /**
   * O par VAPID deste ambiente passa pela leitura? Só tamanhos e validade, nunca
   * o valor: segredo do wrangler não se lê de volta, e este é o jeito de saber
   * se o que foi gravado tinha BOM e se o que sobra serve.
   */
  .get('/vapid', async (c) => {
    if (!chaveAdminConfere(c.req.header('x-admin-key'), c.env)) {
      return c.json({ error: 'nao_autorizado' }, 401);
    }
    return c.json(await diagnosticoVapid(c.env));
  })
  .post('/push-teste', async (c) => {
    if (!chaveAdminConfere(c.req.header('x-admin-key'), c.env)) {
      return c.json({ error: 'nao_autorizado' }, 401);
    }

    const corpo = PushTesteSchema.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ error: 'informe email' }, 400);

    const usuario = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL',
    )
      .bind(normalizarEmail(corpo.data.email))
      .first<{ id: string }>();

    if (!usuario) return c.json({ error: 'usuario_nao_encontrado' }, 404);

    const assinaturas = await assinaturasDoUsuario(c.env.DB, usuario.id);
    if (assinaturas.length === 0) return c.json({ error: 'sem_assinatura' }, 404);

    const resultados = [];
    for (const assinatura of assinaturas) {
      const r = await enviarERegistrar(
        c.env,
        usuario.id,
        assinatura,
        {
          titulo: corpo.data.titulo ?? 'Teste do lembrete',
          corpo: corpo.data.corpo ?? 'Se você está lendo isto, o lembrete está funcionando.',
          url: '/?origem=push',
          tag: 'teste',
        },
        { teste: true },
      );
      resultados.push({ servico: r.servico, ok: r.ok, ...(r.ok ? {} : { erro: r.erro }) });
    }

    return c.json({ ok: true, aparelhos: resultados.length, resultados });
  });
