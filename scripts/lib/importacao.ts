/**
 * O plano e o SQL da importação da base (lançamento, etapa 5).
 *
 * Sem disco, sem rede e sem wrangler: recebe as vendas já lidas e devolve o que
 * vai para o banco. Fica separado do script para dar para testar o SQL num D1
 * de verdade, que é onde um erro de sintaxe ou de conflito aparece.
 */
import { formasDoSku } from '../../src/worker/lib/payt-sku.ts';
import { PROVEDORES } from '../../src/shared/provedores.ts';

export interface Venda {
  email: string;
  nome: string;
  telefone: string;
  transacao: string;
  sku: string;
  produtoCodigo: string;
  produtoNome: string;
  status: string;
  /** ISO UTC, ou null se o relatório não trouxer data que dê para ler. */
  data: string | null;
}

export interface Mapas {
  /** sku da Payt → produto (product_payt_sku). */
  porSku: Map<string, string>;
  /** product.code → produto (product_payt_map). */
  porCodigo: Map<string, string>;
}

/** Sku primeiro, code depois — a mesma ordem do postback (§7 passo 6). */
export function produtoDaVenda(v: Venda, mapas: Mapas): string | null {
  for (const forma of formasDoSku(v.sku)) {
    const id = mapas.porSku.get(forma);
    if (id) return id;
  }
  return mapas.porCodigo.get(v.produtoCodigo.trim()) ?? null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-mail que dá para usar. O `@fake` é o que a Payt põe quando o cliente não deu e-mail. */
export function emailValido(email: string): boolean {
  return EMAIL.test(email) && !email.includes('@fake');
}

export function provedorDoEmail(email: string): string {
  const dominio = email.slice(email.lastIndexOf('@') + 1);
  for (const [nome, dominios] of Object.entries(PROVEDORES)) {
    if (dominios.includes(dominio)) return nome;
  }
  return 'outros';
}

export interface Usuario {
  email: string;
  nome: string | null;
  telefone: string | null;
}

export interface Concessao {
  email: string;
  produto: string;
  transacao: string;
  /** granted_at: a data da venda, que ordena as ondas. */
  quando: string;
}

export interface Plano {
  usuarios: Usuario[];
  concessoes: Concessao[];
}

/**
 * Um usuário por e-mail e uma concessão por (e-mail, produto, transação).
 *
 * O mesmo cliente aparece uma vez por compra — a Jornada e cada upsell são
 * linhas próprias —, e o nome e o telefone ficam do primeiro registro que tiver.
 */
export function planejar(vendas: Array<Venda & { produto: string }>, agora: string): Plano {
  const usuarios = new Map<string, Usuario>();
  const concessoes = new Map<string, Concessao>();

  for (const v of vendas) {
    const atual = usuarios.get(v.email);
    usuarios.set(v.email, {
      email: v.email,
      nome: atual?.nome || v.nome || null,
      telefone: atual?.telefone || v.telefone || null,
    });

    const chave = `${v.email}|${v.produto}|${v.transacao}`;
    if (!concessoes.has(chave)) {
      concessoes.set(chave, {
        email: v.email,
        produto: v.produto,
        transacao: v.transacao,
        quando: v.data ?? agora,
      });
    }
  }

  return { usuarios: [...usuarios.values()], concessoes: [...concessoes.values()] };
}

/** Aspas simples dobradas: o valor vai dentro de um literal SQL. */
function lit(valor: string | null): string {
  return valor === null ? 'NULL' : `'${valor.replace(/'/g, "''")}'`;
}

/** Linhas por INSERT: longe do limite de 100 KB por comando do D1. */
const LOTE = 100;

function emLotes<T>(itens: T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += LOTE) lotes.push(itens.slice(i, i + LOTE));
  return lotes;
}

/**
 * Os comandos SQL da importação, para um arquivo só (`d1 execute --file`).
 *
 * - **Usuário existente não perde nada**: o conflito no e-mail só preenche
 *   telefone e nome que estejam vazios.
 * - **Concessão existente não muda**: `DO NOTHING` no conflito. Se um reembolso
 *   chegou pelo postback depois de o relatório ser exportado, a linha está
 *   revogada no banco e aprovada no arquivo — reativar aqui devolveria o acesso
 *   a quem pediu o dinheiro de volta.
 * - Rodar de novo, com o mesmo relatório ou um mais novo, não duplica nada.
 */
export function sqlDaImportacao(plano: Plano, agora: string, novoId: () => string): string[] {
  const comandos: string[] = [];

  for (const lote of emLotes(plano.usuarios)) {
    const valores = lote
      .map((u) => `(${lit(novoId())}, ${lit(u.email)}, ${lit(u.telefone)}, ${lit(u.nome)}, ${lit(agora)})`)
      .join(',\n  ');
    comandos.push(
      `INSERT INTO users (id, email, phone, name, created_at) VALUES\n  ${valores}\n` +
        `ON CONFLICT (email) DO UPDATE SET\n` +
        `  phone = COALESCE(users.phone, excluded.phone),\n` +
        `  name = COALESCE(users.name, excluded.name);`,
    );
  }

  for (const lote of emLotes(plano.concessoes)) {
    const valores = lote
      .map((c) => `(${lit(novoId())}, ${lit(c.email)}, ${lit(c.produto)}, ${lit(c.transacao)}, ${lit(c.quando)})`)
      .join(',\n  ');
    // O WHERE não é enfeite: sem ele, o SQLite lê o ON CONFLICT como parte do JOIN.
    comandos.push(
      `WITH v (id, email, produto, transacao, quando) AS (VALUES\n  ${valores}\n)\n` +
        `INSERT INTO entitlements (id, user_id, product_id, source, transaction_id, status, granted_at)\n` +
        `SELECT v.id, u.id, v.produto, 'payt', v.transacao, 'active', v.quando\n` +
        `  FROM v JOIN users u ON u.email = v.email\n` +
        ` WHERE u.deleted_at IS NULL\n` +
        `ON CONFLICT (user_id, product_id, transaction_id) DO NOTHING;`,
    );
  }

  return comandos;
}
