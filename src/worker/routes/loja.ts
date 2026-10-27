/**
 * Loja (fase 6).
 *
 * `GET /api/loja`      o que está à venda, com o que a pessoa já tem
 * `GET /api/loja/:id`  a página de um produto, com a prévia do que vem dentro
 *
 * A loja **não decide acesso**: quem decide é o `hasAccess` (§6), chamado por
 * produto. Reimplementar a regra aqui com um `JOIN` esperto seria uma segunda
 * verdade sobre o que a pessoa pode ver, e as duas iam divergir na primeira
 * assinatura.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ItemDaLoja, ParteDoProduto, ProdutoDaLoja, TipoDeProduto } from '../../shared/types';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';
import { hasAccess } from '../services/entitlements';

interface LinhaProduto {
  id: string;
  name: string;
  kind: TipoDeProduto;
  description_md: string | null;
  price_cents: number | null;
  checkout_url: string | null;
  notice: string | null;
}

const CAMPOS = 'id, name, kind, description_md, price_cents, checkout_url, notice';

/**
 * Assinatura fica fora da loja até a fase 7.
 *
 * O Círculo já está no catálogo (preço placeholder, §17) e sem paywall não há o
 * que entregar a quem comprasse: oferecer agora seria vender o que não existe.
 */
const SEM_ASSINATURA = "kind != 'subscription'";

/**
 * O link de checkout com as UTMs da loja (§7).
 *
 * Preserva a query que o link já tiver — link de oferta da Payt costuma vir com
 * parâmetro próprio, e trocar a query inteira mudaria o preço da venda.
 *
 * Com a `conta`, preenche o checkout com `email` e `phone` (os nomes que o
 * checkout da Payt aceita, confirmados pelo Leo). É menos digitação para o
 * público 55+ e, principalmente, a compra sai **no e-mail da conta**: compra
 * com outro e-mail vira outra conta pelo postback, e o conteúdo não aparece
 * para quem comprou. Telefone só se a conta tiver; nome não vai, porque o
 * checkout não pede.
 */
function comUtms(
  url: string | null,
  productId: string,
  conta?: { email: string | null; phone: string | null } | null,
): string | null {
  if (!url?.trim()) return null;

  try {
    const u = new URL(url.trim());
    u.searchParams.set('utm_source', 'app');
    u.searchParams.set('utm_medium', 'loja');
    u.searchParams.set('utm_campaign', productId);
    if (conta?.email) u.searchParams.set('email', conta.email);
    if (conta?.phone) u.searchParams.set('phone', conta.phone);
    return u.toString();
  } catch {
    // Checkout que não é URL é erro de catálogo. Botão para lugar nenhum é pior
    // que não ter botão, então o produto fica sem compra e aparece no admin.
    return null;
  }
}

/** Os programas de cada produto, do banco inteiro: a tabela tem poucas linhas. */
async function programasPorProduto(db: D1Database): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare('SELECT id, product_id FROM programs ORDER BY product_id, id')
    .all<{ id: string; product_id: string }>();

  const mapa = new Map<string, string[]>();
  for (const p of results) {
    mapa.set(p.product_id, [...(mapa.get(p.product_id) ?? []), p.id]);
  }
  return mapa;
}

/** Os itens de cada bundle, na ordem em que a loja mostra. */
async function itensPorBundle(db: D1Database): Promise<Map<string, LinhaProduto[]>> {
  const { results } = await db
    .prepare(
      `SELECT bi.bundle_id AS bundle_id, ${CAMPOS.split(', ')
        .map((c) => `p.${c}`)
        .join(', ')}
         FROM bundle_items bi
         JOIN products p ON p.id = bi.product_id
        ORDER BY bi.bundle_id, p.sort`,
    )
    .all<LinhaProduto & { bundle_id: string }>();

  const mapa = new Map<string, LinhaProduto[]>();
  for (const { bundle_id, ...produto } of results) {
    mapa.set(bundle_id, [...(mapa.get(bundle_id) ?? []), produto]);
  }
  return mapa;
}

/**
 * As partes de um produto: os itens do bundle, ou ele mesmo.
 *
 * Produto que não é bundle é a própria parte, para a página ter sempre uma lista
 * de "o que vem dentro" — a da jornada são os 19 dias.
 */
function partesDe(produto: LinhaProduto, itens: Map<string, LinhaProduto[]>): LinhaProduto[] {
  return produto.kind === 'bundle' ? (itens.get(produto.id) ?? []) : [produto];
}

/**
 * Para onde o botão "Abrir" leva quem já tem o produto.
 *
 * Com um programa só, vai direto nele: o público é 55+ e um toque a mais para
 * chegar na oração é um toque a mais para desistir. Com vários (um bundle), a
 * página do produto é o único lugar que mostra as partes.
 */
function caminhoParaAbrir(
  produto: LinhaProduto,
  partes: LinhaProduto[],
  programas: Map<string, string[]>,
): string {
  const ids = partes.flatMap((p) => programas.get(p.id) ?? []);
  return ids.length === 1 ? `/programa/${ids[0]}` : `/produto/${produto.id}`;
}

/** Avisos obrigatórios (§14): o do produto e os das partes, sem repetir. */
function avisosDe(produto: LinhaProduto, partes: LinhaProduto[]): string[] {
  const todos = [produto.notice, ...partes.map((p) => p.notice)];
  return [...new Set(todos.filter((a): a is string => Boolean(a?.trim())))];
}

async function montarItem(
  db: D1Database,
  userId: string,
  produto: LinhaProduto,
  itens: Map<string, LinhaProduto[]>,
  programas: Map<string, string[]>,
): Promise<ItemDaLoja> {
  const partes = partesDe(produto, itens);
  const temAcesso = await hasAccess(db, userId, produto.id);

  return {
    id: produto.id,
    nome: produto.name,
    kind: produto.kind,
    preco_cents: produto.price_cents,
    tem_checkout: comUtms(produto.checkout_url, produto.id) !== null,
    tem_acesso: temAcesso,
    inclui: produto.kind === 'bundle' ? partes.map((p) => p.name) : [],
    abrir: temAcesso ? caminhoParaAbrir(produto, partes, programas) : null,
  };
}

/** Os títulos das lições de um programa. **Só os títulos** (ver abaixo). */
async function titulosDasLicoes(db: D1Database, programaId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT title FROM lessons WHERE program_id = ? ORDER BY day')
    .bind(programaId)
    .all<{ title: string }>();
  return results.map((l) => l.title);
}

export const loja = new Hono<AppBindings>()
  .get('/', async (c) => {
    const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
    if (!sessao) return c.json({ error: 'nao_autenticado' }, 401);

    const { results } = await c.env.DB.prepare(
      `SELECT ${CAMPOS} FROM products WHERE listed = 1 AND ${SEM_ASSINATURA} ORDER BY sort`,
    ).all<LinhaProduto>();

    const [itens, programas] = await Promise.all([
      itensPorBundle(c.env.DB),
      programasPorProduto(c.env.DB),
    ]);

    const lista: ItemDaLoja[] = [];
    for (const produto of results) {
      lista.push(await montarItem(c.env.DB, sessao.userId, produto, itens, programas));
    }

    return c.json({ itens: lista });
  })

  .get('/:id', async (c) => {
    const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
    if (!sessao) return c.json({ error: 'nao_autenticado' }, 401);

    /*
     * Sem `listed = 1`: a parte de um bundle tem `listed = 0` e precisa de
     * página, senão quem comprou o pacote não tem onde ver o que veio nele.
     */
    const produto = await c.env.DB.prepare(
      `SELECT ${CAMPOS} FROM products WHERE id = ? AND ${SEM_ASSINATURA}`,
    )
      .bind(c.req.param('id'))
      .first<LinhaProduto>();

    if (!produto) return c.json({ error: 'produto_nao_encontrado' }, 404);

    const [itens, programas] = await Promise.all([
      itensPorBundle(c.env.DB),
      programasPorProduto(c.env.DB),
    ]);

    const base = await montarItem(c.env.DB, sessao.userId, produto, itens, programas);
    const partesCruas = partesDe(produto, itens);

    const partes: ParteDoProduto[] = [];
    for (const parte of partesCruas) {
      const programaId = (programas.get(parte.id) ?? [])[0] ?? null;
      partes.push({
        id: parte.id,
        nome: parte.name,
        programa_id: programaId,
        /*
         * Só o título. A prévia é de loja: mandar `body_md` ou `audio_key` aqui
         * entregaria conteúdo pago a quem não comprou, e a chave do R2 nunca vai
         * para o client (§6).
         */
        licoes: programaId ? await titulosDasLicoes(c.env.DB, programaId) : [],
      });
    }

    const usuario = await c.env.DB.prepare('SELECT email, phone FROM users WHERE id = ?')
      .bind(sessao.userId)
      .first<{ email: string | null; phone: string | null }>();

    const resposta: ProdutoDaLoja = {
      ...base,
      descricao_md: produto.description_md,
      avisos: avisosDe(produto, partesCruas),
      partes,
      checkout_url: comUtms(produto.checkout_url, produto.id, usuario),
      // Para o aviso logo acima do botão: compra com outro e-mail cria outra
      // conta pelo postback, e o conteúdo não aparece para quem comprou.
      email_da_conta: usuario?.email ?? null,
    };

    return c.json({ produto: resposta });
  });
