import { applyD1Migrations } from 'cloudflare:test';
import { envTeste } from './env-de-teste';

// Roda antes de cada arquivo de teste; o storage isolado do pool preserva o que
// o setup grava, então cada teste começa com o schema pronto e as tabelas vazias.
await applyD1Migrations(envTeste.DB, envTeste.TEST_MIGRATIONS);
