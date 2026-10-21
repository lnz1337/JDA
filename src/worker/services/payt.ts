/**
 * Postback da Payt (CLAUDE.md §7).
 *
 * O formato V1 ainda não foi visto em produção: as fixtures em `fixtures/payt/`
 * são sintéticas, montadas a partir do que a §7 descreve. Por isso tudo aqui é
 * tolerante — campo que falta não derruba o processamento, e o payload cru é
 * gravado antes de qualquer validação de conteúdo (ver routes/payt.ts).
 */
import { z } from 'zod';
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import { concederEntitlement, revogarPorTransacao } from './entitlements';

/** payment_status que revoga acesso na hora. */
const REVOGAM = new Set(['refunded', 'chargeback', 'one_click_buy_refunded']);

/** payment_status que NÃO revoga sozinho: vai para a fila de revisão do admin. */
const PEDEM_REVISAO = new Set([
  'refunded_partial',
  'one_click_buy_refunded_partial',
  'chargeback_presented',
]);

/** status de assinatura que fazem upsert em subscriptions. */
const ASSINATURA_ATIVA = new Set([
  'subscription_activated',
  'subscription_renewed',
  'subscription_reactivated',
]);

/** type de transação que concede acesso quando paga. */
const TIPOS_DE_COMPRA = new Set(['order', 'upsell', 'manual_upsell']);

/** Status que a §7 manda só registrar. Qualquer outro desconhecido pede revisão. */
const SO_REGISTRAM = new Set(['waiting_payment', 'lost_cart', 'canceled']);

/**
 * Tudo aceita null além de ausente: o postback manda `"subscription": null` em
 * pedido comum, e um schema que só aceitasse `undefined` rejeitaria o payload
 * inteiro por causa disso.
 */
const texto = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? undefined : String(v)));

const frase = z.string().nullish();

const ProdutoSchema = z.looseObject({
  sku: frase,
  code: texto,
  name: frase,
});

const PostbackSchema = z.looseObject({
  test: z.boolean().nullish(),
  type: frase,
  status: frase,
  updated_at: frase,
  transaction_id: texto,
  transaction: z.looseObject({ id: texto, code: texto, payment_status: frase }).nullish(),
  customer: z
    .looseObject({
      name: frase,
      email: frase,
      phone: texto,
      fake_email: z.boolean().nullish(),
      code: texto,
    })
    .nullish(),
  product: ProdutoSchema.extend({ items: z.array(ProdutoSchema).nullish() }).nullish(),
  order_bumps: z.array(z.looseObject({ product: ProdutoSchema.nullish() })).nullish(),
  subscription: z
    .looseObject({
      code: texto,
      status: frase,
      periodicity: frase,
      next_charge_at: frase,
      started_at: frase,
    })
    .nullish(),
});

export type Postback = z.infer<typeof PostbackSchema>;

/** O que o evento é, sem precisar validar o payload inteiro. */
export interface ResumoPostback {
  transactionId: string | null;
  status: string | null;
  paymentStatus: string | null;
  updatedAt: string | null;
}

function comoTexto(valor: unknown): string | null {
  if (typeof valor === 'string') return valor.trim() || null;
  if (typeof valor === 'number') return String(valor);
  return null;
}

function campo(dados: unknown, ...caminho: string[]): unknown {
  let atual: unknown = dados;
  for (const parte of caminho) {
    if (typeof atual !== 'object' || atual === null) return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/**
 * Lê os quatro campos do dedupe_key sem passar pelo Zod: isso roda ANTES da
 * validação, para que um payload de formato inesperado ainda seja gravado.
 */
export function extrairResumo(dados: unknown): ResumoPostback {
  return {
    transactionId:
      comoTexto(campo(dados, 'transaction_id')) ??
      comoTexto(campo(dados, 'transaction', 'id')) ??
      comoTexto(campo(dados, 'transaction', 'code')) ??
      null,
    status: comoTexto(campo(dados, 'status')),
    paymentStatus:
      comoTexto(campo(dados, 'transaction', 'payment_status')) ??
      comoTexto(campo(dados, 'payment_status')),
    updatedAt:
      comoTexto(campo(dados, 'updated_at')) ?? comoTexto(campo(dados, 'transaction', 'updated_at')),
  };
}

/**
 * Texto que vira o dedupe_key. Quando não dá nem para identificar a transação,
 * entra um ULID: payload não identificável precisa ser gravado assim mesmo, e
 * não confundido com repetição de outro igualmente ilegível.
 */
export function textoDedupe(resumo: ResumoPostback): string {
  const base = [resumo.transactionId, resumo.status, resumo.paymentStatus, resumo.updatedAt];
  if (!resumo.transactionId) base.push(novoId());
  return base.map((p) => p ?? '').join('|');
}

/** '1 month' vira mensal, '1 year' vira anual (§7). */
export function planoDaPeriodicidade(periodicity: string | null | undefined): string {
  const p = (periodicity ?? '').toLowerCase();
  if (p.includes('year') || p.includes('ano')) return 'anual';
  if (p.includes('month') || p.includes('mes') || p.includes('mês')) return 'mensal';
  return p || 'mensal';
}

/** Só dígitos, como o banco guarda (§5). */
function soDigitos(valor: string | undefined): string | null {
  const d = (valor ?? '').replace(/\D/g, '');
  return d || null;
}

interface ProdutoBruto {
  sku?: string | null | undefined;
  code?: string | null | undefined;
}

/** Produto, seus itens (bundle agrupado) e cada order bump (§7 passo 6). */
function produtosDoPedido(p: Postback): ProdutoBruto[] {
  const lista: ProdutoBruto[] = [];
  if (p.product) {
    lista.push(p.product);
    for (const item of p.product.items ?? []) lista.push(item);
  }
  for (const bump of p.order_bumps ?? []) {
    if (bump.product) lista.push(bump.product);
  }
  return lista;
}

/**
 * sku → products.id; se não bater, product.code → product_payt_map (§7 passo 6).
 * Produto que não resolve é devolvido em `naoResolvidos` para o admin ver.
 */
export async function resolverProdutos(
  db: D1Database,
  p: Postback,
): Promise<{ ids: string[]; naoResolvidos: string[] }> {
  const ids = new Set<string>();
  const naoResolvidos: string[] = [];

  for (const bruto of produtosDoPedido(p)) {
    const sku = bruto.sku?.trim();
    if (sku) {
      const achado = await db
        .prepare('SELECT id FROM products WHERE id = ?')
        .bind(sku)
        .first<{ id: string }>();
      if (achado) {
        ids.add(achado.id);
        continue;
      }
    }

    const code = bruto.code?.trim();
    if (code) {
      const mapeado = await db
        .prepare('SELECT product_id FROM product_payt_map WHERE payt_code = ?')
        .bind(code)
        .first<{ product_id: string }>();
      if (mapeado) {
        ids.add(mapeado.product_id);
        continue;
      }
    }

    naoResolvidos.push(sku ?? code ?? '(produto sem sku nem code)');
  }

  return { ids: [...ids], naoResolvidos };
}

/**
 * Acha o usuário por e-mail (lowercase), ou por telefone quando o e-mail é falso
 * (§7 passo 5). Cria se não existir.
 */
export async function acharOuCriarUsuario(
  db: D1Database,
  p: Postback,
): Promise<{ userId: string; novo: boolean } | null> {
  const cliente = p.customer;
  const emailFalso = cliente?.fake_email === true;
  const email = emailFalso ? null : (cliente?.email?.trim().toLowerCase() || null);
  const telefone = soDigitos(cliente?.phone);

  if (!email && !telefone) return null;

  const existente = email
    ? await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>()
    : await db
        .prepare('SELECT id FROM users WHERE phone = ? ORDER BY created_at LIMIT 1')
        .bind(telefone)
        .first<{ id: string }>();

  if (existente) {
    // Dados novos que vieram no postback não sobrescrevem o que já existe,
    // só preenchem o que estiver vazio.
    await db
      .prepare(
        `UPDATE users
            SET phone = COALESCE(phone, ?),
                name = COALESCE(name, ?),
                payt_customer_code = COALESCE(payt_customer_code, ?)
          WHERE id = ?`,
      )
      .bind(telefone, cliente?.name ?? null, cliente?.code ?? null, existente.id)
      .run();
    return { userId: existente.id, novo: false };
  }

  const userId = novoId();
  await db
    .prepare(
      `INSERT INTO users (id, email, phone, name, payt_customer_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(userId, email, telefone, cliente?.name ?? null, cliente?.code ?? null, agoraIso())
    .run();

  return { userId, novo: true };
}

async function registrarEvento(
  db: D1Database,
  userId: string | null,
  nome: string,
  props: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare('INSERT INTO events (id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(novoId(), userId, nome, JSON.stringify(props), agoraIso())
    .run();
}

async function salvarAssinatura(
  db: D1Database,
  userId: string,
  p: Postback,
  statusForcado?: string,
): Promise<void> {
  const assinatura = p.subscription;
  const code = assinatura?.code?.trim();
  if (!code) throw new Error('evento de assinatura sem subscription.code');

  const status = statusForcado ?? assinatura?.status ?? 'active';

  await db
    .prepare(
      `INSERT INTO subscriptions (code, user_id, plan, status, next_charge_at, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET
         user_id = excluded.user_id,
         plan = excluded.plan,
         status = excluded.status,
         next_charge_at = COALESCE(excluded.next_charge_at, subscriptions.next_charge_at),
         started_at = COALESCE(subscriptions.started_at, excluded.started_at),
         updated_at = excluded.updated_at`,
    )
    .bind(
      code,
      userId,
      planoDaPeriodicidade(assinatura?.periodicity),
      status,
      assinatura?.next_charge_at ?? null,
      assinatura?.started_at ?? null,
      agoraIso(),
    )
    .run();
}

export interface ResultadoProcessamento {
  acao: string;
  precisaRevisao: boolean;
  detalhe?: Record<string, unknown>;
}

/**
 * Aplica a tabela da §7. Lança em erro de verdade — quem chama grava a mensagem
 * em payt_events.error, sem derrubar a resposta do postback.
 */
export async function processarPostback(
  db: D1Database,
  bruto: unknown,
): Promise<ResultadoProcessamento> {
  const parse = PostbackSchema.safeParse(bruto);
  if (!parse.success) {
    throw new Error(`payload fora do formato esperado: ${parse.error.issues[0]?.message ?? '?'}`);
  }
  const p = parse.data;

  const resumo = extrairResumo(bruto);
  const paymentStatus = resumo.paymentStatus ?? '';
  const status = resumo.status ?? '';

  // Reembolso e chargeback não dependem de achar o usuário: revogam pela transação.
  if (REVOGAM.has(paymentStatus) || REVOGAM.has(status)) {
    if (!resumo.transactionId) throw new Error('evento de revogação sem transaction_id');
    const revogados = await revogarPorTransacao(db, resumo.transactionId);
    return { acao: 'entitlements_revogados', precisaRevisao: false, detalhe: { revogados } };
  }

  if (PEDEM_REVISAO.has(paymentStatus) || PEDEM_REVISAO.has(status)) {
    return { acao: 'marcado_para_revisao', precisaRevisao: true, detalhe: { paymentStatus } };
  }

  const ehAssinatura =
    ASSINATURA_ATIVA.has(status) || status === 'subscription_overdue' || status === 'subscription_canceled';

  const pago = status === 'paid' && paymentStatus === 'paid' && TIPOS_DE_COMPRA.has(p.type ?? '');

  if (!pago && !ehAssinatura) {
    // waiting_payment, lost_cart e canceled são esperados: só ficam registrados.
    // Status que ninguém previu fica registrado também, mas marcado para alguém
    // olhar — é assim que um formato diferente do esperado aparece.
    const conhecido = SO_REGISTRAM.has(status) || SO_REGISTRAM.has(paymentStatus);
    return {
      acao: conhecido ? 'apenas_registrado' : 'status_desconhecido',
      precisaRevisao: !conhecido,
      detalhe: { status, paymentStatus },
    };
  }

  const usuario = await acharOuCriarUsuario(db, p);
  if (!usuario) throw new Error('postback sem e-mail nem telefone: não dá para identificar o usuário');

  if (usuario.novo) {
    // O e-mail de boas-vindas é da fase 4 (auth); aqui só fica o registro.
    await registrarEvento(db, usuario.userId, 'user_created_payt', {
      transaction_id: resumo.transactionId,
      fake_email: p.customer?.fake_email === true,
    });
  }

  if (ehAssinatura) {
    const forcado = status === 'subscription_overdue' ? 'overdue' : undefined;
    await salvarAssinatura(db, usuario.userId, p, forcado);
    return {
      acao: 'assinatura_atualizada',
      precisaRevisao: false,
      detalhe: { status: forcado ?? p.subscription?.status, usuarioNovo: usuario.novo },
    };
  }

  const { ids, naoResolvidos } = await resolverProdutos(db, p);
  for (const productId of ids) {
    await concederEntitlement(db, {
      userId: usuario.userId,
      productId,
      source: 'payt',
      transactionId: resumo.transactionId,
    });
  }

  if (ids.length === 0) {
    throw new Error(
      `nenhum produto do pedido existe no catálogo: ${naoResolvidos.join(', ') || '(pedido sem produto)'}`,
    );
  }

  return {
    acao: 'entitlements_concedidos',
    // Produto que não resolveu precisa de olho humano, mas não impede os outros.
    precisaRevisao: naoResolvidos.length > 0,
    detalhe: { concedidos: ids, naoResolvidos, usuarioNovo: usuario.novo },
  };
}
