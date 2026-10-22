/**
 * Concede acesso manual a um produto (CLAUDE.md §13: "conceder/revogar acesso
 * manual", com `source = 'manual'`).
 *
 *   node scripts/grant.ts <email> <product_id> [ambiente]   (padrão: staging)
 *
 * Serve para suporte e para manter um usuário de teste com acesso sem depender
 * de compra. Entitlement manual não tem `transaction_id`, então reembolso da
 * Payt não o revoga — some só por decisão humana.
 *
 * Idempotente: rodar de novo reativa em vez de duplicar.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = resolve(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const email = (process.argv[2] ?? '').trim().toLowerCase();
const productId = (process.argv[3] ?? '').trim();
const ambiente = process.argv[4] ?? 'staging';

if (!email || !productId) {
  console.error('uso: node scripts/grant.ts <email> <product_id> [ambiente]');
  process.exit(1);
}

/** Aspas simples dobradas: o valor vai dentro de um literal SQL. */
function sql(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

function executar<T>(comando: string): T[] {
  const r = spawnSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', 'DB', '--env', ambiente, '--remote', '--json', '--command', comando],
    { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );

  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || 'falha ao consultar o D1');
    process.exit(1);
  }

  const saida = r.stdout ?? '';
  const inicio = saida.indexOf('[');
  if (inicio < 0) {
    console.error(`não achei JSON na saída do wrangler:\n${saida}`);
    process.exit(1);
  }
  return (JSON.parse(saida.slice(inicio)) as Array<{ results: T[] }>)[0]?.results ?? [];
}

const usuarios = executar<{ id: string }>(
  `SELECT id FROM users WHERE email = ${sql(email)} AND deleted_at IS NULL`,
);
if (usuarios.length === 0) {
  console.error(`nenhum usuário com esse e-mail em ${ambiente}`);
  process.exit(1);
}
const userId = usuarios[0]!.id;

const produtos = executar<{ id: string; name: string }>(
  `SELECT id, name FROM products WHERE id = ${sql(productId)}`,
);
if (produtos.length === 0) {
  console.error(`produto '${productId}' não existe no catálogo de ${ambiente}`);
  process.exit(1);
}

// Dois passos porque a UNIQUE inclui transaction_id, e NULL não conflita com NULL
// no SQLite: sem o WHERE NOT EXISTS, cada rodada criaria uma linha nova.
executar(
  `INSERT INTO entitlements (id, user_id, product_id, source, transaction_id, status, granted_at)
   SELECT ${sql(ulid())}, ${sql(userId)}, ${sql(productId)}, 'manual', NULL, 'active', ${sql(new Date().toISOString())}
    WHERE NOT EXISTS (
      SELECT 1 FROM entitlements
       WHERE user_id = ${sql(userId)} AND product_id = ${sql(productId)} AND source = 'manual'
    )`,
);

executar(
  `UPDATE entitlements
      SET status = 'active', revoked_at = NULL
    WHERE user_id = ${sql(userId)} AND product_id = ${sql(productId)} AND source = 'manual'`,
);

const linhas = executar<{ status: string; granted_at: string; revoked_at: string | null }>(
  `SELECT status, granted_at, revoked_at FROM entitlements
    WHERE user_id = ${sql(userId)} AND product_id = ${sql(productId)} AND source = 'manual'`,
);

console.log(`acesso manual a '${produtos[0]!.name}' (${productId}) em ${ambiente}:`);
for (const l of linhas) {
  console.log(`  status=${l.status} granted_at=${l.granted_at} revoked_at=${l.revoked_at ?? '-'}`);
}
