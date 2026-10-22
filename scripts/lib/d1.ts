/** Consultas ao D1 pela CLI do wrangler, usado pelos scripts de operação. */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRANGLER = resolve(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/** Aspas simples dobradas: o valor vai dentro de um literal SQL. */
export function sql(valor: string | number | null): string {
  if (valor === null) return 'NULL';
  if (typeof valor === 'number') return String(valor);
  return `'${valor.replace(/'/g, "''")}'`;
}

export function consultar<T>(comando: string, ambiente: string): T[] {
  const r = spawnSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', 'DB', '--env', ambiente, '--remote', '--json', '--command', comando],
    { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'falha ao consultar o D1');
  }
  const saida = r.stdout ?? '';
  const inicio = saida.indexOf('[');
  if (inicio < 0) throw new Error(`não achei JSON na saída do wrangler:\n${saida}`);
  return (JSON.parse(saida.slice(inicio)) as Array<{ results: T[] }>)[0]?.results ?? [];
}
