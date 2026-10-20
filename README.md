# PWA devocional São Miguel

PWA de conteúdo devocional católico servido por um único Cloudflare Worker
(API em Hono + assets estáticos do client React). A spec completa está em
[CLAUDE.md](CLAUDE.md); este README cobre só como rodar e publicar.

> Fase atual: **1 — scaffold** (CLAUDE.md §16). Banco, postback da Payt, auth e
> telas entram nas fases seguintes.

## Pré-requisitos

- Node.js 22+
- Conta Cloudflare com acesso a Workers, D1 e R2

## Rodando local

```bash
npm install
cp .dev.vars.example .dev.vars   # secrets locais (fora do git)
npm run dev                      # http://localhost:5173
```

`npm run dev` sobe o Vite com o Worker rodando dentro do workerd
(`@cloudflare/vite-plugin`): a API e o client usam a mesma origem, com D1 e R2
locais criados automaticamente em `.wrangler/`.

Checagem rápida: `GET http://localhost:5173/api/health` devolve

```json
{
  "ok": true,
  "app": "Devocional São Miguel",
  "env": "development",
  "time": "2026-10-20T14:14:50.000Z",
  "bindings": { "db": true, "media": true }
}
```

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Vite + Worker local |
| `npm run build` | Build do client e do Worker em `dist/` |
| `npm run typecheck` | `tsc -b` nos quatro projetos (client, sw, worker, node) |
| `npm test` | Vitest dentro do runtime do Workers |
| `npm run cf-typegen` | Regenera `worker-configuration.d.ts` a partir do wrangler.toml |
| `npm run icons` | Regenera os ícones placeholder do PWA |
| `npm run deploy:staging` | Build com `CLOUDFLARE_ENV=staging` + `wrangler deploy` |
| `npm run deploy:production` | Idem para produção |

Antes de dar uma fase por concluída: `npm run typecheck && npm test`.

## Deploy de staging

O ambiente é escolhido **no build** (`CLOUDFLARE_ENV`), não no `wrangler deploy`:
o `@cloudflare/vite-plugin` gera `dist/jda_pwa/wrangler.json` já resolvido e o
`wrangler deploy` usa esse arquivo.

Staging já está provisionado e no ar:
**https://jda-pwa-staging.leonardovcs2022.workers.dev** (D1 `jda-pwa-staging`,
bucket R2 `jda-pwa-media-staging`).

Para **produção**, uma vez por conta:

```bash
npx wrangler d1 create jda-pwa-prod          # copie o database_id
npx wrangler r2 bucket create jda-pwa-media
```

Preencha `database_id` em `[[env.production.d1_databases]]` no `wrangler.toml`
(hoje `TROCAR_PELO_ID_DO_D1_PROD`), ajuste o `APP_URL` de produção e rode
`npm run cf-typegen`.

A autenticação do wrangler sai de `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID` no ambiente (ou de `npx wrangler login`).

Secrets (CLAUDE.md §15), um a um:

```bash
npx wrangler secret put PAYT_INTEGRATION_KEY --env staging
npx wrangler secret put RESEND_API_KEY --env staging
npx wrangler secret put VAPID_PUBLIC_KEY --env staging
npx wrangler secret put VAPID_PRIVATE_KEY --env staging
npx wrangler secret put VAPID_SUBJECT --env staging
npx wrangler secret put MAIL_FROM --env staging
```

Publicar:

```bash
npm run deploy:staging
```

Para conferir o que seria enviado sem publicar:
`npm run build:staging && npx wrangler deploy --dry-run`.

## Estrutura

```
src/worker/     API Hono (routes/, services/, lib/)
src/client/     PWA React (screens/, components/, sw/)
src/shared/     tipos e constantes usados pelos dois lados
migrations/     SQL do D1 (fase 2)
seed/           seed de produtos/programas/lições (fase 2)
fixtures/payt/  payloads de postback para teste (fase 3)
test/           Vitest no runtime do Workers
```

## Pendências desta fase

- Nome e identidade visual do app: `APP_NAME` em `src/shared/constants.ts` e os
  ícones em `public/icons/` são placeholder (CLAUDE.md §17).
- `database_id` e `APP_URL` de **produção** no `wrangler.toml` (staging já está
  preenchido).
- Secrets ainda não cadastrados em staging (`PAYT_INTEGRATION_KEY`,
  `RESEND_API_KEY`, VAPID): só passam a ser necessários nas fases 3, 4 e 8.
- Domínio final do app.
