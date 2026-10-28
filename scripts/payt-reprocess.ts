/**
 * Reprocessa um evento de postback já gravado.
 *
 *   node scripts/payt-reprocess.ts <transaction_id> [ambiente]
 *   node scripts/payt-reprocess.ts <transaction_id> production --confirmo-revisado
 *
 * O dedupe do postback (CLAUDE.md §7) impede que a Payt reenvie o mesmo evento,
 * então um que falhou — produto ainda não mapeado, por exemplo — precisa ser
 * retomado por aqui. Usa a ADMIN_API_KEY (ambiente ou .dev.vars), não a chave da
 * Payt: quem recebe postback não administra o app.
 *
 * Em produção, só uma transação por vez e com `--confirmo-revisado`: quem roda
 * declara que olhou o evento e que conceder o que ele pede é o certo.
 */
import { chaveAdmin } from './lib/segredos.ts';
const URLS: Record<string, string> = {
  staging: 'https://jda-pwa-staging.leonardovcs2022.workers.dev',
  production: 'https://jornadacomeuanjo.com',
};

const posicionais = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const transactionId = posicionais[0];
const ambiente = posicionais[1] ?? 'staging';
const confirmoRevisado = process.argv.includes('--confirmo-revisado');
if (!transactionId) {
  console.error('uso: node scripts/payt-reprocess.ts <transaction_id> [ambiente]');
  process.exit(1);
}
if (ambiente === 'production' && !confirmoRevisado) {
  console.error('em produção, revise o evento e rode de novo com --confirmo-revisado');
  process.exit(1);
}
const chave = chaveAdmin(ambiente);

const base = URLS[ambiente];
if (!base) {
  console.error(`ambiente desconhecido: ${ambiente} (conheço: ${Object.keys(URLS).join(', ')})`);
  process.exit(1);
}

const res = await fetch(`${base}/api/payt/reprocess`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': chave },
  body: JSON.stringify({
    transaction_id: transactionId,
    ...(confirmoRevisado ? { confirmo_revisado: true } : {}),
  }),
});

const corpo = (await res.json()) as Record<string, unknown>;

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, corpo);
  process.exit(1);
}

console.log(JSON.stringify(corpo, null, 2));
if (corpo.ok === false) process.exit(1);
