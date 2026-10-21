/**
 * Mostra os últimos eventos de postback gravados.
 *
 *   node scripts/payt-last.ts [ambiente] [quantidade]   (padrão: staging, 5)
 *
 * Serve para inspecionar o primeiro postback real da Payt: o endpoint grava o
 * payload cru antes de validar o conteúdo, então mesmo um evento que falhou no
 * processamento aparece aqui inteiro.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = resolve(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const AMBIENTE = process.argv[2] ?? 'staging';
const QUANTIDADE = Number(process.argv[3] ?? 5);

interface Linha {
  id: string;
  received_at: string;
  processed_at: string | null;
  transaction_id: string | null;
  status: string | null;
  payment_status: string | null;
  error: string | null;
  needs_review: number;
  payload_json: string;
}

const consulta =
  `SELECT id, received_at, processed_at, transaction_id, status, payment_status,
          error, needs_review, payload_json
     FROM payt_events
    ORDER BY received_at DESC
    LIMIT ${Number.isFinite(QUANTIDADE) ? QUANTIDADE : 5}`;

const r = spawnSync(
  process.execPath,
  [WRANGLER, 'd1', 'execute', 'DB', '--env', AMBIENTE, '--remote', '--json', '--command', consulta],
  { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
);

if (r.status !== 0) {
  console.error(r.stderr || r.stdout || 'falha ao consultar o D1');
  process.exit(1);
}

// O wrangler às vezes escreve banner antes do JSON: pega do primeiro '[' em diante.
const saida = r.stdout ?? '';
const inicio = saida.indexOf('[');
if (inicio < 0) {
  console.error('não achei JSON na saída do wrangler:\n' + saida);
  process.exit(1);
}

const resultado = JSON.parse(saida.slice(inicio)) as Array<{ results: Linha[] }>;
const linhas = resultado[0]?.results ?? [];

if (linhas.length === 0) {
  console.log(`Nenhum postback gravado em ${AMBIENTE} ainda.`);
  process.exit(0);
}

console.log(`Últimos ${linhas.length} postback(s) em ${AMBIENTE}:\n`);

for (const l of linhas) {
  const situacao = l.error
    ? `ERRO: ${l.error}`
    : l.processed_at
      ? 'processado'
      : 'recebido, ainda não processado';

  console.log('─'.repeat(78));
  console.log(`recebido em   : ${l.received_at}`);
  console.log(`transação     : ${l.transaction_id ?? '(sem transaction_id)'}`);
  console.log(`status        : ${l.status ?? '-'}   payment_status: ${l.payment_status ?? '-'}`);
  console.log(`situação      : ${situacao}`);
  console.log(`revisão       : ${l.needs_review === 1 ? 'SIM — precisa de olho humano' : 'não'}`);
  console.log('payload       :');

  let payload = l.payload_json;
  try {
    payload = JSON.stringify(JSON.parse(l.payload_json), null, 2);
  } catch {
    // Payload que não é JSON fica como veio — é justamente o caso interessante.
  }
  console.log(payload.replace(/^/gm, '  '));
  console.log('');
}
