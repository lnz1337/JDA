import type { D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Secrets } from '../src/worker/lib/types';

/**
 * Bindings que só existem nos testes, injetados pelo vitest.config.ts, mais os
 * secrets do CLAUDE.md §15, que não fazem parte do `Env` gerado. O cast fica
 * isolado aqui.
 */
export interface EnvDeTeste extends Env, Secrets {
  TEST_MIGRATIONS: D1Migration[];
  TEST_SEED_SQL: string;
}

export const envTeste = env as unknown as EnvDeTeste;
