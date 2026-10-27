/**
 * Concede acesso manual a um produto (CLAUDE.md §13).
 *
 *   node scripts/grant.ts <email> <product_id> [ambiente]   (padrão: staging)
 *   ... --criar            cria a conta se o e-mail ainda não existir
 *   ... --nome "Maria"     nome da conta criada (o e-mail usa o primeiro nome)
 *   ... --enviar-acesso    manda o e-mail de boas-vindas com o link que já entra
 *
 * Fala com a rota administrativa do Worker, que é quem tem o banco. Entitlement
 * manual não tem `transaction_id`, então reembolso da Payt não o revoga — some
 * só por decisão humana. Idempotente.
 */
import { chaveAdmin } from './lib/segredos.ts';

const URLS: Record<string, string> = {
  staging: 'https://jda-pwa-staging.leonardovcs2022.workers.dev',
  production: 'https://jornadacomeuanjo.com',
};

const argv = process.argv.slice(2);
const iNome = argv.indexOf('--nome');
const nome = iNome >= 0 ? argv[iNome + 1] : undefined;
const posicionais = argv.filter((a, i) => !a.startsWith('--') && !(iNome >= 0 && i === iNome + 1));

const email = (posicionais[0] ?? '').trim();
const productId = (posicionais[1] ?? '').trim();
const ambiente = posicionais[2] ?? 'staging';
const criar = argv.includes('--criar');
const enviarAcesso = argv.includes('--enviar-acesso');

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
  headers: { 'content-type': 'application/json', 'x-admin-key': chaveAdmin(ambiente) },
  body: JSON.stringify({
    email,
    product_id: productId,
    ...(criar ? { criar_usuario: true } : {}),
    ...(nome ? { nome } : {}),
    ...(enviarAcesso ? { enviar_acesso: true } : {}),
  }),
});

const corpo = (await res.json()) as Record<string, unknown>;
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, corpo);
  process.exit(1);
}
console.log(
  `${email} -> ${corpo.produto} (${corpo.status}, ${corpo.granted_at})` +
    `${corpo.usuario_criado ? ' [conta criada]' : ''}` +
    `${'email_enviado' in corpo ? (corpo.email_enviado ? ' [e-mail de acesso enviado]' : ` [e-mail FALHOU: ${corpo.erro_email}]`) : ''}`,
);
