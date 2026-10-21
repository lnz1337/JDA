/**
 * Reprocessa um evento de postback já gravado.
 *
 *   PAYT_INTEGRATION_KEY=... node scripts/payt-reprocess.ts <transaction_id> [ambiente]
 *
 * O dedupe do postback (CLAUDE.md §7) impede que a Payt reenvie o mesmo evento,
 * então um que falhou — produto ainda não mapeado, por exemplo — precisa ser
 * retomado por aqui. A chave vem do ambiente; nunca de arquivo.
 */
const URLS: Record<string, string> = {
  staging: 'https://jda-pwa-staging.leonardovcs2022.workers.dev',
};

const transactionId = process.argv[2];
const ambiente = process.argv[3] ?? 'staging';
const chave = process.env.PAYT_INTEGRATION_KEY;

if (!transactionId) {
  console.error('uso: node scripts/payt-reprocess.ts <transaction_id> [ambiente]');
  process.exit(1);
}
if (!chave) {
  console.error('defina PAYT_INTEGRATION_KEY no ambiente (o mesmo secret do Worker)');
  process.exit(1);
}

const base = URLS[ambiente];
if (!base) {
  console.error(`ambiente desconhecido: ${ambiente} (conheço: ${Object.keys(URLS).join(', ')})`);
  process.exit(1);
}

const res = await fetch(`${base}/api/payt/reprocess`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-integration-key': chave },
  body: JSON.stringify({ transaction_id: transactionId }),
});

const corpo = (await res.json()) as Record<string, unknown>;

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, corpo);
  process.exit(1);
}

console.log(JSON.stringify(corpo, null, 2));
if (corpo.ok === false) process.exit(1);
