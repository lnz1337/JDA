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
 * O envio de verdade sai em lotes de até 40 (`lib/lotes.ts`), depois de um
 * dry-run com o total que deixa o Worker conferir a trava de onda e a cota:
 * uma chamada só com 200 estourou o timeout de 300 s do fetch em 30/10.
 *
 * Autentica com a chave administrativa do ambiente (`chaveAdmin`: processo ou
 * .dev.vars; a de produção se chama ADMIN_API_KEY_PRODUCTION na cópia local).
 */
import { enviarEmLotes, type RespostaCampanha } from './lib/lotes.ts';
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

const chamar = async (n: number, soConferir: boolean): Promise<RespostaCampanha> => {
  const res = await fetch(`${base}/api/campanha/enviar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': chave },
    body: JSON.stringify({
      campanha,
      limite: n,
      dry_run: soConferir,
      modelo,
      ...(testePara ? { teste_para: testePara } : {}),
      ...(provedores.length > 0 ? { provedores } : {}),
    }),
  });
  const corpo = (await res.json()) as RespostaCampanha;
  // 401 e 400 vêm sem `ok`; o lote trata qualquer coisa diferente de true como recusa.
  return res.ok ? corpo : { ...corpo, ok: false };
};

// Dry-run e envio de teste são uma chamada só: não mandam nada para a base.
if (dryRun || testePara) {
  const corpo = await chamar(limite, dryRun);
  console.log(JSON.stringify(corpo, null, 2));
  if (corpo.ok !== true) process.exit(1);
  process.exit(0);
}

const r = await enviarEmLotes(limite, chamar, (n, lote) => {
  console.log(
    `lote ${n}: ${lote.enviados ?? 0} enviados, ${lote.falhas ?? 0} falhas` +
      ` (hoje: ${lote.enviadosHoje ?? '?'}, cota restante: ${lote.cotaRestante ?? '?'})`,
  );
});

console.log(
  JSON.stringify(
    {
      motivo: r.motivo,
      pedidos: limite,
      selecionados: r.selecionados,
      enviados: r.enviados,
      falhas: r.falhas,
      lotes: r.lotes,
      enviadosHoje: r.ultima?.enviadosHoje,
      cotaRestante: r.ultima?.cotaRestante,
      erros: r.erros.slice(0, 20),
    },
    null,
    2,
  ),
);

switch (r.motivo) {
  case 'completa':
    break;
  case 'fila_vazia':
    console.log(`\nA fila acabou: ${r.enviados + r.falhas} de ${limite} pedidos.`);
    break;
  case 'recusada':
    console.error(`\nRECUSADA pelo Worker: ${r.detalhe ?? 'sem mensagem'}`);
    process.exit(1);
    break;
  case 'taxa_de_falha':
    console.error('\nPAROU: taxa de falha acima de 5%. Confira a entrega antes da próxima onda.');
    process.exit(1);
    break;
  case 'erro_de_rede':
    console.error(
      `\nPAROU por erro de rede: ${r.detalhe}.\n` +
        'O lote em andamento pode ter enviado parte antes de cair. NÃO rode de novo ' +
        'antes de contar o campaign_sends de hoje (docs/ESTADO.md, "Armadilha").',
    );
    process.exit(1);
}
