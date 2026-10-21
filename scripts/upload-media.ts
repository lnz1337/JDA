/**
 * Envia os áudios da jornada para o bucket R2.
 *
 *   node scripts/upload-media.ts [bucket]      (padrão: jda-pwa-media-staging)
 *
 * audio/saida/dNN.mp3      -> jornada/dNN.mp3
 * audio/hino-sao-miguel.mp3 -> jornada/hino-sao-miguel.mp3
 *
 * Lista o bucket antes de enviar e pula o que já está lá com o mesmo tamanho,
 * então rodar de novo depois de regerar um único dia sobe só aquele arquivo.
 *
 * Precisa de CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID no ambiente (a listagem
 * usa a API da Cloudflare; o upload usa `wrangler r2 object put --remote`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = process.argv[2] ?? 'jda-pwa-media-staging';
const PREFIXO = 'jornada/';
const CONTENT_TYPE = 'audio/mpeg';

interface Arquivo {
  local: string;
  chave: string;
}

function arquivos(): Arquivo[] {
  const dias = Array.from({ length: 19 }, (_, i) => {
    const nome = `d${String(i + 1).padStart(2, '0')}.mp3`;
    return { local: resolve(RAIZ, 'audio', 'saida', nome), chave: `${PREFIXO}${nome}` };
  });
  return [
    ...dias,
    {
      local: resolve(RAIZ, 'audio', 'hino-sao-miguel.mp3'),
      chave: `${PREFIXO}hino-sao-miguel.mp3`,
    },
  ];
}

async function listarBucket(): Promise<Map<string, number>> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const conta = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !conta) {
    throw new Error('defina CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID no ambiente');
  }

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${conta}` +
    `/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(PREFIXO)}&per_page=1000`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const corpo = (await res.json()) as {
    success: boolean;
    errors?: Array<{ message: string }>;
    result?: Array<{ key: string; size?: number; content_length?: number }>;
  };

  if (!res.ok || !corpo.success) {
    const motivo = corpo.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`não consegui listar o bucket ${BUCKET}: ${motivo}`);
  }

  return new Map(
    (corpo.result ?? []).map((o) => [o.key, o.size ?? o.content_length ?? -1] as const),
  );
}

/** Entrypoint JS do wrangler: chamar o .cmd pelo spawn quebra no Windows. */
const WRANGLER = resolve(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function enviar(arquivo: Arquivo): void {
  const r = spawnSync(
    process.execPath,
    [
      WRANGLER,
      'r2',
      'object',
      'put',
      `${BUCKET}/${arquivo.chave}`,
      `--file=${arquivo.local}`,
      `--content-type=${CONTENT_TYPE}`,
      '--remote',
    ],
    { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );

  if (r.error) {
    throw new Error(`falha ao enviar ${arquivo.chave}: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `falha ao enviar ${arquivo.chave} (exit ${r.status}):\n${r.stderr || r.stdout || '(sem saída)'}`,
    );
  }
}

const lista = arquivos();

const faltando = lista.filter((a) => !existsSync(a.local));
if (faltando.length > 0) {
  console.error('Arquivos ausentes em audio/ (gere pelo notebook antes):');
  for (const a of faltando) console.error(`  ${a.local}`);
  process.exit(1);
}

const noBucket = await listarBucket();
console.log(`Bucket ${BUCKET}: ${noBucket.size} objeto(s) em ${PREFIXO}`);

let enviados = 0;
let pulados = 0;

for (const arquivo of lista) {
  const tamanhoLocal = statSync(arquivo.local).size;
  const tamanhoRemoto = noBucket.get(arquivo.chave);

  if (tamanhoRemoto === tamanhoLocal) {
    pulados += 1;
    console.log(`= ${arquivo.chave} (já no bucket, ${tamanhoLocal} bytes)`);
    continue;
  }

  const motivo = tamanhoRemoto === undefined ? 'novo' : `tamanho mudou: ${tamanhoRemoto} -> ${tamanhoLocal}`;
  process.stdout.write(`↑ ${arquivo.chave} (${motivo})… `);
  enviar(arquivo);
  enviados += 1;
  console.log('ok');
}

console.log(`\n${enviados} enviado(s), ${pulados} pulado(s), ${lista.length} no total.`);
