/**
 * Concede acesso manual a um produto (CLAUDE.md §13).
 *
 *   node scripts/grant.ts <email> <product_id> [ambiente]   (padrão: staging)
 *
 * Fala com a rota administrativa do Worker, que é quem tem o banco. Entitlement
 * manual não tem `transaction_id`, então reembolso da Payt não o revoga — some
 * só por decisão humana. Idempotente.
 */
import { exigirSegredo } from './lib/segredos.ts';

const URLS: Record<string, string> = {
  staging: 'https://jda-pwa-staging.leonardovcs2022.workers.dev',
  production: 'https://jornadacomeuanjo.com',
};

const email = (process.argv[2] ?? '').trim();
const productId = (process.argv[3] ?? '').trim();
const ambiente = process.argv[4] ?? 'staging';

if (!email || !productId) {
  console.error('uso: node scripts/grant.ts <email> <product_id> [ambiente]');
  process.exit(1);
}

const base = URLS[ambiente];
if (!base) {
  console.error(`ambiente desconhecido: ${ambiente}`);
  process.exit(1);
}

const res = await fetch(`${base}/api/admin/conceder`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': exigirSegredo('ADMIN_API_KEY') },
  body: JSON.stringify({ email, product_id: productId }),
});

const corpo = (await res.json()) as Record<string, unknown>;
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, corpo);
  process.exit(1);
}
console.log(`${email} -> ${corpo.produto} (${corpo.status}, ${corpo.granted_at})`);
