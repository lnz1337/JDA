/**
 * Lê um segredo do ambiente ou do .dev.vars (que está fora do git).
 * Os scripts de operação precisam da ADMIN_API_KEY, que vive só como secret no
 * Worker — a cópia local existe para não ter que digitar a chave toda hora.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function segredo(nome: string): string | undefined {
  const doAmbiente = process.env[nome];
  if (doAmbiente) return doAmbiente;

  const arquivo = resolve(RAIZ, '.dev.vars');
  if (!existsSync(arquivo)) return undefined;

  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    const m = new RegExp(`^\s*${nome}\s*=\s*(.*)$`).exec(linha);
    if (m) return (m[1] ?? '').trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

export function exigirSegredo(nome: string): string {
  const v = segredo(nome);
  if (!v) {
    console.error(`${nome} não encontrado. Defina no ambiente ou no .dev.vars (fora do git).`);
    process.exit(1);
  }
  return v;
}
