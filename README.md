# PWA devocional São Miguel

PWA de conteúdo devocional católico servido por um único Cloudflare Worker
(API em Hono + assets estáticos do client React). A spec completa está em
[CLAUDE.md](CLAUDE.md); este README cobre só como rodar e publicar.

> Fase atual: **3 — postback da Payt** (CLAUDE.md §16). Schema do D1, seed, áudios
> no R2 e o endpoint de postback com `entitlements.ts`. Auth e telas entram nas
> fases seguintes.

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
| `npm run db:migrate:local` / `:staging` | Aplica as migrations do D1 |
| `npm run seed:build` | Gera `seed/seed.sql` a partir dos JSON de seed |
| `npm run seed:local` / `:staging` | Gera e aplica o seed (idempotente) |
| `npm run media:upload:staging` | Sobe os MP3 de `audio/` para o R2 de staging |
| `npm run payt:last:staging` | Últimos 5 postbacks da Payt gravados no staging |
| `npm run payt:reprocess:staging <tx>` | Reprocessa um postback já gravado |
| `npm run grant:staging <email> <produto>` | Concede acesso manual (`source = 'manual'`) |
| `npm run cf-typegen` | Regenera `worker-configuration.d.ts` a partir do wrangler.toml |
| `npm run icons` | Regenera os ícones placeholder do PWA |
| `npm run deploy:staging` | Build com `CLOUDFLARE_ENV=staging` + `wrangler deploy` |
| `npm run deploy:production` | Idem para produção |

Antes de dar uma fase por concluída: `npm run typecheck && npm test`.

## Banco, seed e mídia

O conteúdo mora em markdown e os JSON de seed são gerados (**não editar à mão**):

```bash
python3 conteudo/gerar_seed.py           # jornada-19-dias.md  -> seed/jornada-19-dias.json
python3 conteudo/gerar_seed_produtos.py  # conteudo/produtos/* -> seed/produtos.json
npm run db:migrate:local                 # cria o schema
npm run seed:local                       # seed/*.json -> seed/seed.sql -> D1
```

`seed/catalogo.json` é a exceção: mantido à mão, só com dado comercial (preço,
checkout, ordem), e os `id` são os **SKU cadastrados na Payt**. Cada campo tem uma
fonte só — o seed falha se o mesmo campo aparecer em duas (CLAUDE.md §3).
O SQL gerado é idempotente
(`INSERT ... ON CONFLICT DO UPDATE`), então rodar o seed de novo atualiza em vez de
duplicar. Duas colunas são preservadas no conflito (`checkout_url` e `duration_s`):
um valor que já exista no banco não é sobrescrito por `NULL`.

A duração de cada lição é lida do MP3 local em `audio/saida/dNN.mp3` na hora de
gerar o SQL. Sem a pasta `audio/`, o seed roda igual e mantém as durações que já
estiverem no banco.

Os áudios ficam fora do git. Para publicá-los no R2 de staging:

```bash
npm run media:upload:staging
```

O caminho local espelha a chave no R2, que é o `audio_key` do banco:

| Local | Chave no R2 |
|---|---|
| `audio/saida/dNN.mp3` | `jornada/dNN.mp3` |
| `audio/hino-sao-miguel.mp3` | `jornada/hino-sao-miguel.mp3` |
| `audio/saida/<produto>/lNN.mp3` | `<produto>/lNN.mp3` |

A lista sai dos mesmos JSON que o seed lê, então chave no D1 e objeto no R2 não
divergem. O script lista o bucket antes e pula o que já está lá com o mesmo
tamanho; regerou um áudio só, ele sobe só aquele. Lição cujo MP3 ainda não existe
é avisada, não é erro. Precisa de `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`
no ambiente.

## Postback da Payt

Endpoint: `POST /api/payt/postback`. Cadastrar na Payt em
Ferramentas → Integrações → Postback, tipo **PayT V1**, todos os eventos.

**Antes de cadastrar**, grave o secret — sem ele o endpoint responde 401 a tudo e
nada é gravado:

```bash
npx wrangler secret put PAYT_INTEGRATION_KEY --env staging
```

Depois da primeira compra de teste:

```bash
npm run payt:last:staging
```

O endpoint grava o payload **antes** de validar o conteúdo (com a
`integration_key` mascarada), então o postback aparece aí inteiro mesmo que o
processamento falhe.

Evento que falhou não pode ser reenviado pela Payt: o `dedupe_key` barra o
postback idêntico. Para retomar:

```bash
PAYT_INTEGRATION_KEY=... npm run payt:reprocess:staging X9P8DY5
```

Isso relê o payload gravado e roda o processamento de novo, atualizando a mesma
linha. A chave vai **só no header** `x-integration-key` — a rota não aceita
segredo no corpo. A rota é recusada quando `ENV=production` — lá o caminho é o botão
"reprocessar" do admin (CLAUDE.md §13), atrás do Cloudflare Access. As fixtures em
`fixtures/payt/` são sintéticas até serem substituídas pelo formato real — veja
`fixtures/payt/README.md`.

### Acesso manual

Para manter um usuário de teste com acesso sem depender de compra, ou para
suporte (CLAUDE.md §13):

```bash
npm run grant:staging alguem@exemplo.com.br jornada-meu-anjo
```

O entitlement entra com `source = 'manual'` e sem `transaction_id`, então
reembolso da Payt não o revoga — ele sai só por decisão humana. Rodar de novo
reativa em vez de duplicar.

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
migrations/     SQL do D1
seed/           produtos.json (à mão) + jornada-19-dias.json (gerado)
conteudo/       fonte da verdade do conteúdo + pipeline de áudio
notebooks/      geração dos MP3 no Google Colab
scripts/        seed -> SQL, upload de mídia, ícones
audio/          MP3 gerados — fora do git
fixtures/payt/  payloads de postback para teste (fase 3)
test/           Vitest no runtime do Workers
```

## Pendências desta fase

- `checkout_url` dos produtos está `NULL`: depende dos links da Payt (CLAUDE.md §17).
  A coluna é preservada no seed, então pode ser preenchida pelo admin sem medo.
- Preços do Círculo (`circulo-mensal`, `circulo-anual`) são placeholder.
- Lições dos itens de bundle são placeholder (`_Conteúdo em produção._`).
- Nome e identidade visual do app: `APP_NAME` em `src/shared/constants.ts` e os
  ícones em `public/icons/` são placeholder (CLAUDE.md §17).
- `database_id` e `APP_URL` de **produção** no `wrangler.toml` (staging já está
  preenchido).
- Secrets ainda não cadastrados em staging (`PAYT_INTEGRATION_KEY`,
  `RESEND_API_KEY`, VAPID): só passam a ser necessários nas fases 3, 4 e 8.
- Domínio final do app.
