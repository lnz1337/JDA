/**
 * Importa a exportação de vendas da Payt para a base do app.
 *
 *   node scripts/import-compradores.ts <arquivo.xlsx|.csv> --colunas
 *   node scripts/import-compradores.ts <arquivo.xlsx|.csv> --env production --dry-run
 *   node scripts/import-compradores.ts <arquivo.xlsx|.csv> --env production
 *
 * O relatório da Payt vem em `.xlsx` e é lido direto, sem passar pelo Excel
 * (ver scripts/lib/xlsx.ts). CSV continua aceito.
 *
 * Só importa venda **paga**: reembolsada, chargeback e cancelada ficam de fora,
 * senão quem pediu o dinheiro de volta ganharia acesso.
 *
 * O produto sai do sku primeiro e do code depois, a mesma ordem do postback
 * (§7 passo 6). O entitlement entra com `source = 'payt'` e o `transaction_id`
 * real — assim um reembolso futuro revoga pelo caminho normal do postback.
 *
 * Produto pago sem mapeamento **interrompe** a importação com relatório. Pular
 * calado deixaria cliente sem acesso e ninguém saberia.
 *
 * Tudo vai num arquivo SQL só (`d1 execute --file`): um comando do wrangler por
 * venda levaria horas. Depois de aplicar, conta de novo no banco e compara com
 * o que o plano previa.
 *
 * Idempotente: roda de novo, com o mesmo relatório ou um mais novo, sem duplicar.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { acharColuna } from './lib/colunas.ts';
import { lerCsv } from './lib/csv.ts';
import { consultar, executarArquivo } from './lib/d1.ts';
import { dataDaVendaParaIso } from './lib/data-venda.ts';
import {
  emailValido,
  planejar,
  produtoDaVenda,
  provedorDoEmail,
  sqlDaImportacao,
  type Mapas,
  type Venda,
} from './lib/importacao.ts';
import { lerXlsx } from './lib/xlsx.ts';

const argv = process.argv.slice(2);
const valor = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const arquivo = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--env');
const ambiente = valor('--env') ?? 'staging';
const dryRun = argv.includes('--dry-run');
const soColunas = argv.includes('--colunas');

if (!arquivo) {
  console.error('uso: node scripts/import-compradores.ts <arquivo.xlsx|.csv> --env <staging|production> [--dry-run]');
  process.exit(1);
}

/** Nomes que a exportação da Payt costuma usar, em ordem de preferência. */
const CANDIDATOS = {
  email: ['email', 'e-mail', 'customer_email', 'cliente_email', 'email_cliente', 'comprador_email'],
  nome: ['nome', 'name', 'customer_name', 'cliente', 'nome_cliente', 'comprador'],
  telefone: ['telefone', 'phone', 'celular', 'customer_phone', 'whatsapp'],
  transacao: ['transaction_id', 'transacao', 'id_transacao', 'codigo', 'code', 'pedido', 'order_id'],
  sku: ['sku', 'product_sku', 'sku_produto'],
  produtoCodigo: ['product_code', 'codigo_produto', 'produto_codigo'],
  produtoNome: ['product_name', 'produto', 'nome_produto', 'product'],
  status: ['status_pagamento', 'payment_status', 'status', 'situacao'],
  // A data da venda vira o granted_at do entitlement: é por ela que a campanha
  // ordena as ondas (mais recente primeiro). Sem ela, toda a base importada
  // ficaria com o horário da importação e a ordem não diria nada.
  data: [
    'data_da_venda', 'data_venda', 'data_pagamento', 'paid_at', 'data_aprovacao',
    'approved_at', 'created_at', 'data', 'date',
  ],
};

// "Pagamento Aprovado" e "Pagamento Reembolsado" são como o relatório em .xlsx
// da Payt escreve a coluna "Status Pagamento".
const PAGOS = new Set([
  'paid', 'pago', 'aprovado', 'approved', 'completo', 'complete', 'pagamento aprovado',
]);
const RECUSADOS = new Set([
  'refunded', 'reembolsado', 'pagamento reembolsado', 'estornado', 'chargeback', 'canceled', 'cancelled',
  'cancelado', 'refused', 'recusado', 'waiting_payment', 'aguardando', 'pending', 'pendente',
  'refunded_partial', 'expired', 'expirado',
]);

const ehXlsx = arquivo.toLowerCase().endsWith('.xlsx');
const lido = ehXlsx
  ? await lerXlsx(arquivo)
  : { ...lerCsv(readFileSync(arquivo, 'utf8')), planilhas: [] as string[] };
const { colunas, linhas } = lido;

const mapa = Object.fromEntries(
  Object.entries(CANDIDATOS).map(([chave, nomes]) => [chave, acharColuna(colunas, nomes)]),
) as Record<keyof typeof CANDIDATOS, string | null>;

console.log(`Arquivo: ${arquivo}`);
if (lido.planilhas.length > 0) {
  console.log(`Planilhas: ${lido.planilhas.join(', ')} (lendo a primeira)`);
}
console.log(`Linhas: ${linhas.length}`);
console.log(`\nColunas encontradas (${colunas.length}):`);
for (const c of colunas) console.log(`  ${c}`);
console.log('\nMapeamento que vou usar:');
for (const [chave, coluna] of Object.entries(mapa)) {
  console.log(`  ${chave.padEnd(15)} -> ${coluna ?? '*** NÃO ENCONTRADA ***'}`);
}

if (linhas[0]) {
  /*
   * Dado pessoal sai mascarado: o que se confere aqui é se a coluna certa foi
   * escolhida, e para isso basta o formato. Data e status saem inteiros, porque
   * são eles que decidem a ordem das ondas e quem entra.
   */
  const pessoais = new Set(['email', 'nome', 'telefone']);
  const mascarar = (v: string) =>
    v.length <= 4 ? '***' : `${v.slice(0, 2)}***${v.slice(-2)} (${v.length} caracteres)`;
  console.log('\nPrimeira linha, pelo mapeamento:');
  for (const [chave, coluna] of Object.entries(mapa)) {
    const bruto = coluna ? (linhas[0][coluna] ?? '') : null;
    const mostrado = bruto === null ? '-' : pessoais.has(chave) ? mascarar(bruto) : JSON.stringify(bruto);
    console.log(`  ${chave.padEnd(15)} = ${mostrado}`);
  }
  if (mapa.data) {
    const lida = dataDaVendaParaIso(linhas[0][mapa.data]);
    console.log(`  data lida como  = ${lida ?? '*** NÃO CONSEGUI LER ***'} (UTC)`);
  }
}

if (soColunas) {
  console.log('\n(--colunas: parei aqui, nada foi importado)');
  process.exit(0);
}

const faltando = (['email', 'transacao', 'status'] as const).filter((k) => !mapa[k]);
if (!mapa.sku && !mapa.produtoCodigo) faltando.push('sku ou código do produto' as never);
if (faltando.length > 0) {
  console.error(`\nNÃO DÁ PARA IMPORTAR: faltam as colunas ${faltando.join(', ')}.`);
  console.error('Rode com --colunas e me diga quais colunas correspondem.');
  process.exit(1);
}

// --- vendas ---------------------------------------------------------------
const campo = (l: Record<string, string>, coluna: string | null) => (coluna ? (l[coluna] ?? '') : '').trim();

const vendas: Venda[] = linhas.map((l) => ({
  email: campo(l, mapa.email).toLowerCase(),
  nome: campo(l, mapa.nome),
  telefone: campo(l, mapa.telefone).replace(/\D/g, ''),
  transacao: campo(l, mapa.transacao),
  sku: campo(l, mapa.sku),
  produtoCodigo: campo(l, mapa.produtoCodigo),
  produtoNome: campo(l, mapa.produtoNome),
  status: campo(l, mapa.status).toLowerCase(),
  data: dataDaVendaParaIso(campo(l, mapa.data)),
}));

const contar = <T>(itens: T[], chave: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of itens) m.set(chave(x), (m.get(chave(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const n = (x: number) => x.toLocaleString('pt-BR').padStart(6);

console.log('\nVendas por status:');
for (const [status, qtd] of contar(vendas, (v) => v.status || '(vazio)')) {
  console.log(`  ${n(qtd)}  ${status}${PAGOS.has(status) ? '   <- entra' : ''}`);
}

const pagas = vendas.filter((v) => PAGOS.has(v.status));
const statusDesconhecidos = [
  ...new Set(vendas.map((v) => v.status).filter((s) => !PAGOS.has(s) && !RECUSADOS.has(s))),
];
if (statusDesconhecidos.length > 0) {
  console.error(`\nPAREI: status que eu não sei classificar: ${statusDesconhecidos.join(', ')}`);
  console.error('Me diga se cada um conta como pago ou não antes de importar.');
  process.exit(1);
}

// --- produtos -------------------------------------------------------------
const mapas: Mapas = {
  porSku: new Map(
    consultar<{ payt_sku: string; product_id: string }>(
      'SELECT payt_sku, product_id FROM product_payt_sku',
      ambiente,
    ).map((m) => [m.payt_sku, m.product_id]),
  ),
  porCodigo: new Map(
    consultar<{ payt_code: string; product_id: string }>(
      'SELECT payt_code, product_id FROM product_payt_map',
      ambiente,
    ).map((m) => [m.payt_code, m.product_id]),
  ),
};

const resolvidas = pagas.map((v) => ({ ...v, produto: produtoDaVenda(v, mapas) }));
const semMapeamento = resolvidas.filter((v) => !v.produto);

if (semMapeamento.length > 0) {
  console.error(`\nProdutos pagos sem mapeamento (nem sku nem code) em ${ambiente}:`);
  for (const [produto, qtd] of contar(semMapeamento, (v) => `${v.sku || v.produtoCodigo || '(sem sku)'} — ${v.produtoNome || '(sem nome)'}`)) {
    console.error(`  ${n(qtd)} venda(s)  ${produto}`);
  }
  if (!dryRun) {
    console.error('\nPAREI: adicione o payt_sku (ou o payt_map) em seed/catalogo.json, rode o seed e tente de novo.');
    process.exit(1);
  }
} else {
  console.log('\nTodo produto pago tem mapeamento.');
}

const mapeadas = resolvidas.filter((v): v is Venda & { produto: string } => v.produto !== null);
const semEmail = mapeadas.filter((v) => !emailValido(v.email));
const importaveis = mapeadas.filter((v) => emailValido(v.email));

// --- plano ----------------------------------------------------------------
const agora = new Date().toISOString();
const plano = planejar(importaveis, agora);

// O que já está no banco: a diferença é o que a importação cria.
const existentes = new Set(
  consultar<{ email: string }>(
    'SELECT email FROM users WHERE email IS NOT NULL AND deleted_at IS NULL',
    ambiente,
  ).map((u) => u.email),
);
const concessoesExistentes = new Set(
  consultar<{ email: string; product_id: string; transaction_id: string }>(
    `SELECT u.email, e.product_id, e.transaction_id
       FROM entitlements e JOIN users u ON u.id = e.user_id
      WHERE e.transaction_id IS NOT NULL`,
    ambiente,
  ).map((c) => `${c.email}|${c.product_id}|${c.transaction_id}`),
);

const usuariosNovos = plano.usuarios.filter((u) => !existentes.has(u.email));
const concessoesNovas = plano.concessoes.filter(
  (c) => !concessoesExistentes.has(`${c.email}|${c.produto}|${c.transacao}`),
);

const datas = plano.concessoes.map((c) => c.quando).sort();
const semData = importaveis.filter((v) => !v.data).length;

console.log(`\nVendas pagas: ${pagas.length} | importáveis: ${importaveis.length} | sem e-mail válido: ${semEmail.length}`);
console.log(`\nClientes únicos: ${plano.usuarios.length}  (dimensiona as ondas)`);
console.log(`  novos em ${ambiente}: ${usuariosNovos.length} | já existiam: ${plano.usuarios.length - usuariosNovos.length}`);
console.log('  por provedor:');
for (const [provedor, qtd] of contar(plano.usuarios, (u) => provedorDoEmail(u.email))) {
  console.log(`    ${n(qtd)}  ${provedor}`);
}

console.log('\nEntitlements por produto (no relatório | novos):');
const novosPorProduto = new Map(contar(concessoesNovas, (c) => c.produto));
for (const [produto, qtd] of contar(plano.concessoes, (c) => c.produto)) {
  console.log(`  ${n(qtd)} | ${n(novosPorProduto.get(produto) ?? 0)}  ${produto}`);
}
console.log(`  ${n(plano.concessoes.length)} | ${n(concessoesNovas.length)}  total`);

if (datas.length > 0) console.log(`\nVendas de ${datas[0]} a ${datas.at(-1)} (UTC)`);
if (semData > 0) {
  console.warn(
    `AVISO: ${semData} venda(s) sem data que eu consiga ler; entram com a data da importação` +
      ' e a ordem das ondas não diz nada para elas.',
  );
}

if (dryRun) {
  console.log('\n(--dry-run: nada foi gravado)');
  process.exit(0);
}

// --- importação -----------------------------------------------------------
interface Contagem {
  usuarios: number;
  porProduto: Map<string, number>;
}

function contarNoBanco(): Contagem {
  const usuarios = consultar<{ n: number }>('SELECT COUNT(*) AS n FROM users', ambiente)[0]?.n ?? 0;
  const porProduto = new Map(
    consultar<{ product_id: string; n: number }>(
      "SELECT product_id, COUNT(*) AS n FROM entitlements WHERE source = 'payt' GROUP BY product_id",
      ambiente,
    ).map((l) => [l.product_id, l.n]),
  );
  return { usuarios, porProduto };
}

const antes = contarNoBanco();

/*
 * O arquivo tem e-mail, nome e telefone de cliente: vai para a pasta temporária
 * do sistema, nunca para o repositório, e sai no fim mesmo se a execução falhar.
 */
const caminhoSql = join(tmpdir(), `importacao-${ambiente}-${Date.now()}.sql`);
writeFileSync(caminhoSql, `${sqlDaImportacao(plano, agora, ulid).join('\n\n')}\n`, 'utf8');
try {
  executarArquivo(caminhoSql, ambiente);
} finally {
  rmSync(caminhoSql, { force: true });
}

const depois = contarNoBanco();

/*
 * Confere no banco em vez de confiar na saída do wrangler: comando com várias
 * instruções no `d1 execute` já passou sem efeito e sem erro neste projeto.
 */
let divergiu = false;
const conferir = (rotulo: string, esperado: number, obtido: number) => {
  const ok = esperado === obtido;
  if (!ok) divergiu = true;
  console.log(`  ${ok ? 'ok ' : 'DIVERGIU'}  ${rotulo}: esperado +${esperado}, banco +${obtido}`);
};

console.log(`\nConferência em ${ambiente} (antes → depois):`);
conferir('usuários', usuariosNovos.length, depois.usuarios - antes.usuarios);
const produtos = new Set([...novosPorProduto.keys(), ...depois.porProduto.keys()]);
for (const produto of produtos) {
  conferir(
    `entitlements ${produto}`,
    novosPorProduto.get(produto) ?? 0,
    (depois.porProduto.get(produto) ?? 0) - (antes.porProduto.get(produto) ?? 0),
  );
}

if (divergiu) {
  console.error('\nA contagem não bate com o plano. Não rode de novo antes de entender a diferença.');
  process.exit(1);
}
console.log(`\nPronto em ${ambiente}: ${usuariosNovos.length} usuário(s) novo(s), ${concessoesNovas.length} entitlement(s) novo(s).`);
if (semEmail.length > 0) {
  console.log(`${semEmail.length} venda(s) sem e-mail válido — use scripts/exportar-sem-email.ts.`);
}
