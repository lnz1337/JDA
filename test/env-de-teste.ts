import type { D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

/**
 * Bindings que só existem nos testes, injetados pelo vitest.config.ts. Não fazem
 * parte do `Env` do Worker, por isso o cast fica isolado aqui.
 */
export interface EnvDeTeste extends Env {
  TEST_MIGRATIONS: D1Migration[];
  TEST_SEED_SQL: string;
}

export const envTeste = env as unknown as EnvDeTeste;
