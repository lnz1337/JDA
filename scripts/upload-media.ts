/**
 * Envia para o R2 os áudios referenciados pelo seed.
 *
 *   node scripts/upload-media.ts [bucket]      (padrão: jda-pwa-media-staging)
 *
 * A lista sai das MESMAS fontes que o seed usa, então a chave no R2 é sempre o
 * `audio_key` que foi para o banco — não dá para divergir:
 *
 *   jornada/dNN.mp3              <- audio/saida/dNN.mp3
 *   jornada/hino-sao-miguel.mp3  <- audio/hino-sao-miguel.mp3
 *   <produto>/lNN.mp3            <- audio/saida/<produto>/lNN.mp3
 *
 * Lista o bucket antes de enviar (uma chamada por prefixo) e pula o que já está
 * lá com o mesmo tamanho. Lição sem áudio gravado ainda é só avisada, não é erro.
 *
 * Precisa de CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID no ambiente (a listagem
 * usa a API da Cloudflare; o upload usa `wrangler r2 object put --remote`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BONUS } from './seed-sql.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = process.argv[2] ?? 'jda-pwa-media-staging';
const CONTENT_TYPE = 'audio/mpeg';

/** Entrypoint JS do wrangler: chamar o .cmd pelo spawn quebra no Windows. */
const WRANGLER = resolve(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

interface Arquivo {
  chave: string;
  local: string;
}

function lerJson<T>(caminho: string): T {
  return JSON.parse(readFileSync(resolve(RAIZ, caminho), 'utf8')) as T;
}

/** audio/saida/<chave>, audio/saida/<arquivo> ou audio/<arquivo>, o que existir. */
function acharLocal(chave: string): string | null {
  const candidatos = [
    resolve(RAIZ, 'audio', 'saida', chave),
    resolve(RAIZ, 'audio', 'saida', basename(chave)),
    resolve(RAIZ, 'audio', basename(chave)),
  ];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

function chavesDoSeed(): string[] {
  const jornada = lerJson<{ lessons: Array<{ audio_key: string | null }> }>(
    'seed/jornada-19-dias.json',
  );
  const produtos = lerJson<{ lessons: Array<{ audio_key: string | null }> }>('seed/produtos.json');

  const chaves = [
    ...jornada.lessons.map((l) => l.audio_key),
    BONUS.audio_key,
    ...produtos.lessons.map((l) => l.audio_key),
  ].filter((c): c is string => Boolean(c));

  return [...new Set(chaves)].sort();
}

async function listarBucket(prefixos: string[]): Promise<Map<string, number>> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const conta = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !conta) {
    throw new Error('defina CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID no ambiente');
  }

  const mapa = new Map<string, number>();

  for (const prefixo of prefixos) {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${conta}` +
      `/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(prefixo)}&per_page=1000`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const corpo = (await res.json()) as {
      success: boolean;
      errors?: Array<{ message: string }>;
      result?: Array<{ key: string; size?: number; content_length?: number }>;
    };

    if (!res.ok || !corpo.success) {
      const motivo = corpo.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`;
      throw new Error(`não consegui listar ${BUCKET}/${prefixo}: ${motivo}`);
    }

    for (const o of corpo.result ?? []) {
      mapa.set(o.key, o.size ?? o.content_length ?? -1);
    }
  }

  return mapa;
}

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

const chaves = chavesDoSeed();
const encontrados: Arquivo[] = [];
const semArquivo: string[] = [];

for (const chave of chaves) {
  const local = acharLocal(chave);
  if (local) encontrados.push({ chave, local });
  else semArquivo.push(chave);
}

if (semArquivo.length > 0) {
  console.log(`Sem MP3 local ainda (não serão enviados): ${semArquivo.length}`);
  for (const c of semArquivo) console.log(`  ${c}`);
  console.log('');
}

const prefixos = [...new Set(encontrados.map((a) => `${a.chave.split('/')[0]}/`))].sort();
const noBucket = await listarBucket(prefixos);
console.log(`Bucket ${BUCKET}: ${noBucket.size} objeto(s) em ${prefixos.join(', ')}`);

let enviados = 0;
let pulados = 0;

for (const arquivo of encontrados) {
  const tamanhoLocal = statSync(arquivo.local).size;
  const tamanhoRemoto = noBucket.get(arquivo.chave);

  if (tamanhoRemoto === tamanhoLocal) {
    pulados += 1;
    console.log(`= ${arquivo.chave} (já no bucket, ${tamanhoLocal} bytes)`);
    continue;
  }

  const motivo =
    tamanhoRemoto === undefined ? 'novo' : `tamanho mudou: ${tamanhoRemoto} -> ${tamanhoLocal}`;
  process.stdout.write(`↑ ${arquivo.chave} (${motivo}, de ${relative(RAIZ, arquivo.local)})… `);
  enviar(arquivo);
  enviados += 1;
  console.log('ok');
}

console.log(
  `\n${enviados} enviado(s), ${pulados} pulado(s), ${encontrados.length} no bucket, ` +
    `${semArquivo.length} ainda sem áudio.`,
);
