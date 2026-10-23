/**
 * Importa a exportação de vendas da Payt para a base do app.
 *
 *   node scripts/import-compradores.ts <arquivo.csv> --env staging [--dry-run]
 *   node scripts/import-compradores.ts <arquivo.csv> --colunas
 *
 * Só importa venda **paga**: reembolsada, chargeback e cancelada ficam de fora,
 * senão quem pediu o dinheiro de volta ganharia acesso.
 *
 * O entitlement entra com `source = 'payt'` e o `transaction_id` real — assim um
 * reembolso futuro revoga pelo caminho normal do postback, sem exceção.
 *
 * Produto sem mapeamento em `product_payt_map` **interrompe** a importação com
 * relatório. Pular calado deixaria cliente sem acesso e ninguém saberia.
 *
 * Idempotente: roda de novo sem duplicar.
 */
import { readFileSync } from 'node:fs';
import { lerCsv } from './lib/csv.ts';
import { dataDaVendaParaIso } from './lib/data-venda.ts';
import { consultar, sql } from './lib/d1.ts';
import { ulid } from 'ulid';

const argv = process.argv.slice(2);
const arquivo = argv.find((a) => !a.startsWith('--'));
const ambiente = argv[argv.indexOf('--env') + 1] ?? 'staging';
const dryRun = argv.includes('--dry-run');
const soColunas = argv.includes('--colunas');

if (!arquivo) {
  console.error('uso: node scripts/import-compradores.ts <arquivo.csv> --env <staging|production> [--dry-run]');
  process.exit(1);
}

/** Nomes que a exportação da Payt costuma usar, em ordem de preferência. */
const CANDIDATOS = {
  email: ['email', 'e-mail', 'customer_email', 'cliente_email', 'email_cliente', 'comprador_email'],
  nome: ['nome', 'name', 'customer_name', 'cliente', 'nome_cliente', 'comprador'],
  telefone: ['telefone', 'phone', 'celular', 'customer_phone', 'whatsapp'],
  transacao: ['transaction_id', 'transacao', 'id_transacao', 'codigo', 'code', 'pedido', 'order_id'],
  produtoCodigo: ['product_code', 'codigo_produto', 'produto_codigo', 'sku', 'product_sku'],
  produtoNome: ['product_name', 'produto', 'nome_produto', 'product'],
  status: ['status', 'situacao', 'situação', 'payment_status', 'status_pagamento'],
  // A data da venda vira o granted_at do entitlement: é por ela que a campanha
  // ordena as ondas (mais recente primeiro). Sem ela, toda a base importada
  // ficaria com o horário da importação e a ordem não diria nada.
  data: [
    'data_pagamento', 'paid_at', 'data_da_venda', 'data_venda', 'data_aprovacao',
    'approved_at', 'created_at', 'data', 'date',
  ],
};

const PAGOS = new Set(['paid', 'pago', 'aprovado', 'approved', 'completo', 'complete']);
const RECUSADOS = new Set([
  'refunded', 'reembolsado', 'estornado', 'chargeback', 'canceled', 'cancelled',
  'cancelado', 'refused', 'recusado', 'waiting_payment', 'aguardando', 'pending', 'pendente',
  'refunded_partial', 'expired', 'expirado',
]);

const texto = readFileSync(arquivo, 'utf8');
const { colunas, linhas } = lerCsv(texto);

function acharColuna(nomes: string[]): string | null {
  const normal = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  for (const n of nomes) {
    const achada = colunas.find((c) => normal(c) === normal(n));
    if (achada) return achada;
  }
  for (const n of nomes) {
    const achada = colunas.find((c) => normal(c).includes(normal(n)));
    if (achada) return achada;
  }
  return null;
}

const mapa = Object.fromEntries(
  Object.entries(CANDIDATOS).map(([chave, nomes]) => [chave, acharColuna(nomes)]),
) as Record<keyof typeof CANDIDATOS, string | null>;

console.log(`Arquivo: ${arquivo}`);
console.log(`Linhas: ${linhas.length}`);
console.log(`\nColunas encontradas (${colunas.length}):`);
for (const c of colunas) console.log(`  ${c}`);
console.log('\nMapeamento que vou usar:');
for (const [chave, coluna] of Object.entries(mapa)) {
  console.log(`  ${chave.padEnd(15)} -> ${coluna ?? '*** NÃO ENCONTRADA ***'}`);
}

if (linhas[0]) {
  console.log('\nPrimeira linha, pelo mapeamento:');
  for (const [chave, coluna] of Object.entries(mapa)) {
    console.log(`  ${chave.padEnd(15)} = ${coluna ? JSON.stringify(linhas[0][coluna]) : '-'}`);
  }
}

if (soColunas) {
  console.log('\n(--colunas: parei aqui, nada foi importado)');
  process.exit(0);
}

const faltando = (['email', 'transacao', 'status'] as const).filter((k) => !mapa[k]);
if (faltando.length > 0) {
  console.error(`\nNÃO DÁ PARA IMPORTAR: faltam as colunas ${faltando.join(', ')}.`);
  console.error('Rode com --colunas e me diga quais colunas correspondem.');
  process.exit(1);
}

// --- seleção -------------------------------------------------------------
interface Venda {
  email: string;
  nome: string;
  telefone: string;
  transacao: string;
  produtoCodigo: string;
  produtoNome: string;
  status: string;
  /** ISO UTC, ou null se o CSV não trouxer data que dê para ler. */
  data: string | null;
}

const vendas: Venda[] = linhas.map((l) => ({
  email: (mapa.email ? l[mapa.email] : '')?.trim().toLowerCase() ?? '',
  nome: (mapa.nome ? l[mapa.nome] : '')?.trim() ?? '',
  telefone: ((mapa.telefone ? l[mapa.telefone] : '') ?? '').replace(/\D/g, ''),
  transacao: (mapa.transacao ? l[mapa.transacao] : '')?.trim() ?? '',
  produtoCodigo: (mapa.produtoCodigo ? l[mapa.produtoCodigo] : '')?.trim() ?? '',
  produtoNome: (mapa.produtoNome ? l[mapa.produtoNome] : '')?.trim() ?? '',
  status: (mapa.status ? l[mapa.status] : '')?.trim().toLowerCase() ?? '',
  data: dataDaVendaParaIso(mapa.data ? l[mapa.data] : null),
}));

const pagas = vendas.filter((v) => PAGOS.has(v.status));
const descartadas = vendas.filter((v) => !PAGOS.has(v.status));
const statusDesconhecidos = [...new Set(descartadas.map((v) => v.status).filter((s) => !RECUSADOS.has(s)))];

console.log(`\nVendas pagas: ${pagas.length} | descartadas: ${descartadas.length}`);
if (statusDesconhecidos.length > 0) {
  console.error(`\nPAREI: status que eu não sei classificar: ${statusDesconhecidos.join(', ')}`);
  console.error('Me diga se cada um conta como pago ou não antes de importar.');
  process.exit(1);
}

// Sem data não dá para ordenar onda por data de compra: avisa em vez de fingir.
const semData = pagas.filter((v) => !v.data).length;
if (semData > 0) {
  console.warn(
    `\nAVISO: ${semData} venda(s) sem data que eu consiga ler` +
      `${mapa.data ? ` (coluna ${mapa.data})` : ' (nenhuma coluna de data encontrada)'}.` +
      '\nElas entram com a data da importação, e a ordem das ondas por data de compra' +
      '\nnão diz nada para essas linhas. Rode com --colunas para conferir.',
  );
}

// --- produtos ------------------------------------------------------------
const mapeamentos = consultar<{ payt_code: string; product_id: string }>(
  'SELECT payt_code, product_id FROM product_payt_map',
  ambiente,
);
const porCodigo = new Map(mapeamentos.map((m) => [m.payt_code, m.product_id]));

const semMapeamento = new Map<string, number>();
for (const v of pagas) {
  if (!porCodigo.has(v.produtoCodigo)) {
    semMapeamento.set(
      `${v.produtoCodigo || '(sem código)'} — ${v.produtoNome || '(sem nome)'}`,
      (semMapeamento.get(`${v.produtoCodigo || '(sem código)'} — ${v.produtoNome || '(sem nome)'}`) ?? 0) + 1,
    );
  }
}

if (semMapeamento.size > 0) {
  console.error(`\nPAREI: ${semMapeamento.size} produto(s) sem mapeamento em product_payt_map:\n`);
  for (const [produto, n] of [...semMapeamento].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${n.toString().padStart(5)} venda(s)  ${produto}`);
  }
  console.error('\nAdicione o payt_map em seed/catalogo.json (ou à mão, se for só de staging) e rode de novo.');
  process.exit(1);
}

// --- importação ----------------------------------------------------------
const semEmail = pagas.filter((v) => !v.email || v.email.includes('@fake'));
const importaveis = pagas.filter((v) => v.email && !v.email.includes('@fake'));

console.log(`Importáveis: ${importaveis.length} | sem e-mail válido: ${semEmail.length}`);

if (dryRun) {
  console.log('\n(--dry-run: nada foi gravado)');
  const porProduto = new Map<string, number>();
  for (const v of importaveis) {
    const id = porCodigo.get(v.produtoCodigo) ?? '?';
    porProduto.set(id, (porProduto.get(id) ?? 0) + 1);
  }
  console.log('\nEntitlements que seriam concedidos:');
  for (const [produto, n] of porProduto) console.log(`  ${n.toString().padStart(5)}  ${produto}`);
  process.exit(0);
}

const agora = new Date().toISOString();
let usuarios = 0;
let concedidos = 0;

for (const v of importaveis) {
  const productId = porCodigo.get(v.produtoCodigo)!;

  const existente = consultar<{ id: string }>(
    `SELECT id FROM users WHERE email = ${sql(v.email)}`,
    ambiente,
  );

  let userId = existente[0]?.id;
  if (!userId) {
    userId = ulid();
    consultar(
      `INSERT INTO users (id, email, phone, name, created_at)
       VALUES (${sql(userId)}, ${sql(v.email)}, ${sql(v.telefone || null)}, ${sql(v.nome || null)}, ${sql(agora)})`,
      ambiente,
    );
    usuarios += 1;
  } else {
    consultar(
      `UPDATE users SET phone = COALESCE(phone, ${sql(v.telefone || null)}),
                        name = COALESCE(name, ${sql(v.nome || null)})
        WHERE id = ${sql(userId)}`,
      ambiente,
    );
  }

  consultar(
    `INSERT INTO entitlements (id, user_id, product_id, source, transaction_id, status, granted_at)
     VALUES (${sql(ulid())}, ${sql(userId)}, ${sql(productId)}, 'payt', ${sql(v.transacao)}, 'active', ${sql(v.data ?? agora)})
     ON CONFLICT (user_id, product_id, transaction_id) DO UPDATE SET
       status = 'active', revoked_at = NULL`,
    ambiente,
  );
  concedidos += 1;
}

console.log(`\nPronto em ${ambiente}: ${usuarios} usuário(s) novo(s), ${concedidos} entitlement(s).`);
if (semEmail.length > 0) {
  console.log(`${semEmail.length} venda(s) sem e-mail válido — use scripts/exportar-sem-email.ts.`);
}
