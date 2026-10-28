/**
 * Dispara a campanha de anúncio do app.
 *
 *   node scripts/campanha-anuncio.ts --env production --limite 50
 *   ... --dry-run                 só mostra o que faria
 *   ... --teste-para eu@ex.com    manda só para esse endereço, sem tocar na base
 *   ... --provedores gmail        põe o Gmail na frente da fila (lista por vírgula)
 *   ... --modelo curto            manda o texto curto (anuncio-app-curto.md)
 *
 * A seleção, o controle de onda e o corte por taxa de falha ficam no Worker
 * (services/campanhas.ts): é lá que estão o banco e o envio.
 *
 * Autentica com a chave administrativa do ambiente (`chaveAdmin`: processo ou
 * .dev.vars; a de produção se chama ADMIN_API_KEY_PRODUCTION na cópia local).
 */
import { chaveAdmin } from './lib/segredos.ts';
const URLS: Record<string, string> = {
  staging: 'https://jda-pwa-staging.leonardovcs2022.workers.dev',
  production: 'https://jornadacomeuanjo.com',
};

const argv = process.argv.slice(2);
const valor = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const ambiente = valor('--env') ?? 'staging';
const limite = Number(valor('--limite') ?? 0);
const testePara = valor('--teste-para');
const dryRun = argv.includes('--dry-run');
const campanha = valor('--campanha') ?? 'anuncio-app';
const modelo = valor('--modelo') ?? 'padrao';
const provedores = (valor('--provedores') ?? '')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);
const chave = chaveAdmin(ambiente);

if (!Number.isFinite(limite) || limite <= 0) {
  console.error('informe --limite N');
  process.exit(1);
}
const base = URLS[ambiente];
if (!base) {
  console.error(`ambiente desconhecido: ${ambiente}`);
  process.exit(1);
}

console.log(
  `campanha=${campanha} ambiente=${ambiente} limite=${limite}` +
    `${dryRun ? ' [dry-run]' : ''}${testePara ? ` [teste para ${testePara}]` : ''}` +
    `${provedores.length > 0 ? ` [provedores: ${provedores.join(' > ')}]` : ''}` +
    ` [modelo: ${modelo}]`,
);

const res = await fetch(`${base}/api/campanha/enviar`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': chave },
  body: JSON.stringify({
    campanha,
    limite,
    dry_run: dryRun,
    modelo,
    ...(testePara ? { teste_para: testePara } : {}),
    ...(provedores.length > 0 ? { provedores } : {}),
  }),
});

const corpo = (await res.json()) as Record<string, unknown>;
console.log(JSON.stringify(corpo, null, 2));

if (!res.ok || corpo.ok === false) process.exit(1);
if (corpo.parouPorFalha === true) {
  console.error('\nPAROU: taxa de falha acima de 5%. Confira a entrega antes da próxima onda.');
  process.exit(1);
}
