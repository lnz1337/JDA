import { env } from 'cloudflare:workers';
import { envTeste } from './env-de-teste';

/**
 * O @cloudflare/vitest-plugin não isola storage por teste (o antigo
 * vitest-pool-workers isolava), então cada arquivo de teste limpa o banco antes
 * de cada caso. Ordem: filho antes de pai, por causa das FKs.
 */
const TABELAS = [
  'campaign_sends',
  'intention_prayers',
  'intentions',
  'progress',
  'enrollments',
  'entitlements',
  'subscriptions',
  'push_subscriptions',
  'events',
  'payt_events',
  'login_codes',
  'sessions',
  'bundle_items',
  'lessons',
  'programs',
  'product_payt_map',
  'products',
  'users',
];

/** O gerador separa os comandos com `-- @stmt`; aqui só limpamos os comentários. */
export function comandosDoSeed(sql: string): string[] {
  return sql
    .split(/^-- @stmt$/m)
    .map((bloco) =>
      bloco
        .split('\n')
        .filter((linha) => !linha.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((bloco) => bloco.length > 0);
}

/** Aplica o seed inteiro no D1 do teste. */
export async function aplicarSeed(): Promise<void> {
  const stmts = comandosDoSeed(envTeste.TEST_SEED_SQL);
  await env.DB.batch(stmts.map((sql) => env.DB.prepare(sql)));
}

/** Esvazia as tabelas da aplicação (não mexe em d1_migrations). */
export async function limparBanco(): Promise<void> {
  await env.DB.batch(TABELAS.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

/** Banco limpo e com o seed aplicado. */
export async function prepararBanco(): Promise<void> {
  await limparBanco();
  await aplicarSeed();
}
