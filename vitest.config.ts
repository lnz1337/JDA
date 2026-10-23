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
                /*
                 * Par VAPID **sintético**, gerado só para o teste: ele precisa
                 * ser um ponto P-256 de verdade para a biblioteca aceitar, mas
                 * não é o de nenhum ambiente. As chaves reais vivem só como
                 * secret (CLAUDE.md §15).
                 */
                VAPID_PUBLIC_KEY:
                  'BJkELrNZ_z_apnVQsk6voQ9w0YaGmDSciNAnt2neucyS-mYPUGtcydve0Frowdq6Ur-_l_tQzB1avIC6uKt8x08',
                VAPID_PRIVATE_KEY: 'ivvRPS7gd9oYxkPxisPaFYhQRu2PulTc8ITkpCl6Ix0',
                VAPID_SUBJECT: 'mailto:suporte@exemplo.test',
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
