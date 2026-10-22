import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { gerarSeedSql } from './scripts/seed-sql.ts';

// Migrations e seed entram como bindings de teste: o runtime do Workers não lê
// disco, então tudo que vem de arquivo é resolvido aqui, no Node.
const migrations = await readD1Migrations('./migrations');
const { sql: seedSql } = gerarSeedSql();

export default defineConfig({
  test: {
    projects: [
      {
        // Validação do gerador de seed: roda em Node, não precisa do workerd.
        test: {
          name: 'node',
          include: ['test/node/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.toml' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: migrations,
                TEST_SEED_SQL: seedSql,
                // Valor sintético, igual ao das fixtures. A integration_key real
                // vive só como secret (wrangler secret put), nunca em arquivo.
                PAYT_INTEGRATION_KEY: 'chave-de-teste-sintetica',
                // Credencial administrativa, separada da chave da Payt.
                ADMIN_API_KEY: 'chave-admin-de-teste',
              },
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/*.test.ts'],
          setupFiles: ['./test/setup-migrations.ts'],
        },
      },
    ],
  },
});
