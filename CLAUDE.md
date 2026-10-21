# CLAUDE.md — PWA devocional São Miguel

> Spec do projeto. Leia inteiro antes de qualquer tarefa. Nome do app ainda é placeholder: `{{APP_NAME}}`.

## 1. O que é

PWA de conteúdo devocional católico (São Miguel Arcanjo / Padre Pio) entregue a quem compra a oferta principal na Payt. Dentro do app o usuário:

- faz a **Jornada de 19 dias** (liberada com a compra do front), um dia por vez;
- compra **produtos avulsos** (novenas, trilhas temáticas, os upsells que recusou no funil);
- assina o **Círculo de São Miguel** (recorrência mensal/anual): devocional diário, novena do mês, publicar intenções no mural;
- recebe **push** no horário de oração que escolheu.

Toda a monetização roda pela **Payt** (checkout + postback). O app nunca processa pagamento: ele só concede/revoga acesso a partir dos postbacks.

## 2. Stack

| Camada | Escolha |
|---|---|
| Runtime | Um único Cloudflare Worker servindo API + assets estáticos (Workers Static Assets) |
| API | Hono + TypeScript |
| Front | Vite + React + TypeScript + `vite-plugin-pwa` (manifest + service worker) |
| Build/dev | `@cloudflare/vite-plugin`: o Worker roda dentro do `vite dev` (mesma origem para API e client) e o build gera `dist/client` + `dist/jda_pwa` |
| Testes | Vitest + `@cloudflare/vitest-plugin` (sucessor do `@cloudflare/vitest-pool-workers`, que foi descontinuado) |
| Estilo | Tailwind |
| Banco | Cloudflare D1 (migrations em `migrations/`) |
| Arquivos | Cloudflare R2 (áudios MP3, PDFs, capas) servidos via Worker com checagem de acesso |
| E-mail | Resend (login por código + transacionais) |
| Push | Web Push com VAPID, lib compatível com Workers (WebCrypto, ex.: `@block65/webcrypto-web-push`; validar antes) |
| Cron | Cron Triggers do Worker (push diário, ofertas D+3) |
| Admin | Rotas `/admin/*` protegidas por Cloudflare Access |

Sem Supabase, sem Next.js, sem servidor fora da Cloudflare.

### Ambientes e deploy

O ambiente é escolhido **no build**, não no deploy. `CLOUDFLARE_ENV=staging vite build`
resolve o `wrangler.toml` e grava `dist/jda_pwa/wrangler.json`; o `wrangler deploy`
publica esse arquivo. Passar `--env` no `wrangler deploy` é **ignorado** — quem manda
é a variável no build. Use sempre `npm run deploy:staging` / `npm run deploy:production`.

## 3. Estrutura de pastas

```
/
├─ src/
│  ├─ worker/            # Hono: index.ts, routes/, services/, lib/
│  │  ├─ routes/         # auth, me, programs, lessons, media, store, mural, push, payt, admin
│  │  ├─ services/       # entitlements.ts, payt.ts, push.ts, offers.ts, mail.ts
│  │  └─ cron.ts
│  ├─ client/            # React PWA
│  │  ├─ screens/        # Onboarding, Home, Jornada, Player, Loja, Produto, Mural, Intencao, Perfil, Assinatura
│  │  ├─ components/
│  │  └─ sw/             # service worker custom (push + cache)
│  └─ shared/            # tipos e constantes usados nos dois lados
├─ migrations/           # SQL D1 numerado
├─ seed/                 # produtos.json (à mão) + jornada-19-dias.json (gerado)
├─ conteudo/             # fonte da verdade do conteúdo + pipeline de áudio
├─ notebooks/            # geração dos MP3 no Google Colab
├─ scripts/              # seed → SQL, upload de mídia, ícones
├─ audio/                # MP3 gerados — fora do git
├─ fixtures/payt/        # payloads de postback reais/anonimizados para testes
├─ test/
└─ wrangler.toml
```

### Conteúdo, seed e áudio

O conteúdo mora em markdown e os JSON de seed são **gerados**. Nunca editar um
JSON gerado à mão: a próxima geração sobrescreve.

| Fonte da verdade | Gera | Com |
|---|---|---|
| `conteudo/jornada-19-dias.md` | `seed/jornada-19-dias.json` | `python3 conteudo/gerar_seed.py` |
| `conteudo/produtos/*.md` | `seed/produtos.json` | `python3 conteudo/gerar_seed_produtos.py` |
| `conteudo/*.md` + `conteudo/gerar_audio.py` | os MP3 em `audio/` | `notebooks/gerar_audio_colab.ipynb` (Colab) |

`seed/catalogo.json` é a exceção: mantido **à mão**, só com dado comercial
(`price_cents`, `checkout_url`, `listed`, `sort`, `requires_subscription`). Os `id`
são os **SKU cadastrados na Payt**.

**Uma fonte por campo** — `scripts/seed-sql.ts` falha se um campo aparecer em duas:

- nome, descrição, aviso, lições e `bundle_id` dos itens de bundle → `seed/produtos.json`;
- produto, programa e as 19 lições da jornada → `seed/jornada-19-dias.json`;
- preço, checkout, ordem e assinatura → `seed/catalogo.json`;
- o nome dos bundles e das assinaturas também vem do catálogo, porque esses
  produtos não têm arquivo de conteúdo.

Os MP3 ficam em `audio/` (`audio/saida/dNN.mp3` e `audio/hino-sao-miguel.mp3`) e
**não entram no git**: o destino é o R2, via `npm run media:upload:staging`. A
duração de cada lição é lida do MP3 local na hora de gerar o SQL.

### Quem mexe em quê

O pipeline de conteúdo é tocado por outra sessão. Para não haver colisão:

| Caminho | Dono |
|---|---|
| `conteudo/`, `notebooks/`, `seed/jornada-19-dias.json`, `seed/produtos.json` | pipeline de conteúdo |
| `seed/catalogo.json`, `scripts/`, `migrations/`, `src/`, `test/` | aplicação |

Quem trabalha na aplicação **não edita** os caminhos do pipeline — se precisar de
mudança lá (um campo novo no JSON, por exemplo), pede em vez de editar.

## 4. Navegação (telas)

```
Acesso pós-compra (link do e-mail/WhatsApp)
  └─ Onboarding: login por código → instalar na tela inicial → ativar push → escolher horário
      └─ Home (oração do dia + card de oferta contextual)
          ├─ Jornada  → Player do dia (áudio + reflexão + "concluí")
          ├─ Loja     → Produto (prévia + botão de compra; itens bloqueados com cadeado)
          ├─ Mural    → Intenção (rezar por ela / contador "X pessoas rezaram")
          └─ Perfil   → Assinatura (status, próxima cobrança, link de gestão), horário de oração, sair, excluir conta
```

Bottom nav com 4 abas: Jornada, Loja, Mural, Perfil. Home é a tela inicial da aba Jornada.

## 5. Modelo de dados (D1)

Todos os IDs são TEXT (ULID). Datas em ISO 8601 UTC. Valores em centavos.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,                 -- lowercase; pode ser NULL se fake_email
  phone TEXT,                        -- só dígitos
  name TEXT,
  payt_customer_code TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  prayer_hour INTEGER NOT NULL DEFAULT 7,   -- 0..23, hora local do push
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- token opaco em cookie httpOnly
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,               -- slug; DEVE ser igual ao SKU cadastrado na Payt
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('program','bundle','subscription')),
  description_md TEXT,
  price_cents INTEGER,
  checkout_url TEXT,                 -- link de checkout Payt
  cover_key TEXT,                    -- R2
  notice TEXT,                       -- aviso obrigatório na tela (ex.: saúde, seção 14)
  requires_subscription INTEGER NOT NULL DEFAULT 0,  -- conteúdo incluso no Círculo
  listed INTEGER NOT NULL DEFAULT 1, -- aparece na loja
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_payt_map (      -- fallback quando SKU não bate: product.code da Payt → produto
  payt_code TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id)
);

CREATE TABLE bundle_items (          -- ex.: UP1 = oração + manual + mapa
  bundle_id TEXT NOT NULL REFERENCES products(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  PRIMARY KEY (bundle_id, product_id)
);

CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  title TEXT NOT NULL,
  unlock_rule TEXT NOT NULL CHECK (unlock_rule IN ('daily','all')),
  total_days INTEGER NOT NULL,
  available_from TEXT                -- novena do mês do Círculo: só aparece a partir desta data
);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  day INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,                      -- frase curta usada na lista de dias
  body_md TEXT,
  audio_key TEXT,
  pdf_key TEXT,
  duration_s INTEGER,
  push_text TEXT,                    -- texto do push daquele dia (seção 11)
  bonus_audio_key TEXT,              -- faixa extra; ex.: hino no dia 19
  bonus_title TEXT,
  UNIQUE (program_id, day)
);

CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  source TEXT NOT NULL CHECK (source IN ('payt','manual')),
  transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (user_id, product_id, transaction_id)
);

CREATE TABLE subscriptions (
  code TEXT PRIMARY KEY,             -- subscription.code da Payt
  user_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL,                -- 'mensal' | 'anual' (derivado de periodicity)
  status TEXT NOT NULL,              -- espelha subscription.status da Payt
  next_charge_at TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE enrollments (
  user_id TEXT NOT NULL REFERENCES users(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, program_id)
);

CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE payt_events (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,   -- sha256(transaction_id|status|payment_status|updated_at)
  transaction_id TEXT,
  status TEXT,
  payment_status TEXT,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error TEXT
);

CREATE TABLE intentions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,                -- máx. 280 chars
  status TEXT NOT NULL CHECK (status IN ('visible','pending','hidden')),
  prayer_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE intention_prayers (
  intention_id TEXT NOT NULL REFERENCES intentions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (intention_id, user_id)
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_success_at TEXT
);

CREATE TABLE events (                -- analytics simples
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,                -- ex.: lesson_completed, offer_viewed, offer_clicked
  props_json TEXT,
  created_at TEXT NOT NULL
);
```

## 6. Regras de acesso

Uma função só decide acesso: `hasAccess(userId, productId)` em `services/entitlements.ts`.

```
hasAccess =
     existe entitlement active para o produto
  OR existe entitlement active para um bundle que contém o produto
  OR (product.requires_subscription = 1 AND assinaturaValida(user))

assinaturaValida =
     status IN ('active','pending')
  OR (status = 'overdue' AND agora < next_charge_at + 3 dias)          -- carência
  OR (status LIKE 'canceled%' AND agora < next_charge_at)               -- período já pago
```

Toda rota de conteúdo (`/api/lessons/:id`, `/media/*`) chama `hasAccess`. Mídia do R2 nunca tem URL pública: o Worker faz stream com suporte a `Range` (necessário para o player de áudio no iOS).

### Liberação por dia (`unlock_rule = 'daily'`)

- Dia N liberado quando `diasDesde(enrollment.started_at, timezone do usuário) >= N - 1`.
- Não exige concluir o dia anterior (quem atrasa não fica travado), mas a UI destaca o "dia de hoje".
- `enrollment` é criado no primeiro acesso ao programa, não na compra.

## 7. Integração Payt (postback V1)

Endpoint: `POST /api/payt/postback`. Cadastrar na Payt em Ferramentas → Integrações → Postback, tipo **PayT V1**, **todos os eventos**.

### Processamento

1. Validar `integration_key` contra o secret `PAYT_INTEGRATION_KEY`. Se não bater, responde 401.
2. Se `test === true` e `ENV=production`, gravar e ignorar.
3. Gravar em `payt_events` com `dedupe_key`. Se for duplicado, responde 200 e para.
4. Responder **200 rápido** e processar via `ctx.waitUntil`. Erro no processamento vai para `payt_events.error`, sem quebrar a resposta.
5. Encontrar ou criar o usuário:
   - por `customer.email` (lowercase), exceto se `customer.fake_email === true`;
   - senão, por `customer.phone`.
6. Resolver produtos do pedido: `product.sku` → `products.id`; fallback `product.code` → `product_payt_map`. Incluir `product.items` (grouped) e cada `order_bumps[].product`.
7. Aplicar a tabela abaixo.

| Evento (status / transaction.payment_status) | Ação |
|---|---|
| `status = paid` e `payment_status = paid` (type order, upsell ou manual_upsell) | Conceder entitlement de cada produto resolvido. Se o usuário é novo, enviar e-mail de boas-vindas com link de acesso |
| `payment_status` em `refunded`, `chargeback`, `one_click_buy_refunded` | Revogar entitlements com aquele `transaction_id` |
| `payment_status` em `refunded_partial`, `one_click_buy_refunded_partial`, `chargeback_presented` | Não revogar automaticamente; registrar e marcar para revisão no admin |
| `subscription_activated`, `subscription_renewed`, `subscription_reactivated` | Upsert em `subscriptions` com `subscription.*` |
| `subscription_overdue` | Atualizar status para `overdue` (a carência vale pela regra da seção 6) |
| `subscription_canceled` | Atualizar status com `subscription.status` (ex.: `canceled_by_customer`) |
| `waiting_payment`, `lost_cart`, `canceled` | Só registrar (futuro: recuperação) |

`subscription.periodicity`: `1 month` vira `mensal`, `1 year` vira `anual`.

### Testes obrigatórios

Usar `fixtures/payt/*.json`: pedido pago, pedido com order bump, upsell, reembolso, chargeback, ativação, renovação, atraso e cancelamento de assinatura, `fake_email`, postback duplicado, `integration_key` inválida. Rodar com Vitest + `@cloudflare/vitest-plugin`.

### Compra dentro do app

- Botão de compra abre `products.checkout_url` com `utm_source=app&utm_medium=loja&utm_campaign={product_id}`.
- **A confirmar na Payt:** se o checkout aceita pré-preenchimento de nome/e-mail por query param. Se aceitar, preencher com os dados do usuário logado para reduzir atrito.
- Depois do pagamento, o app faz polling leve de `/api/me/entitlements` (a cada 5 s por até 2 min) ao voltar para a aba, para liberar o produto sem precisar recarregar.

## 8. Autenticação

- Login por **código de 6 dígitos no e-mail** (Resend). Código com hash, expira em 15 min, máximo de 5 tentativas.
- Sessão em cookie `httpOnly; Secure; SameSite=Lax`, validade de 90 dias, renovada a cada uso.
- O e-mail de boas-vindas pós-compra leva um link `/entrar?e={email}` com o campo já preenchido.
- Usuário com `fake_email`: login por telefone, com o código enviado por WhatsApp (**fase 2**; no MVP, contato manual pelo suporte).

## 9. Ofertas contextuais (`services/offers.ts`)

Uma função `getOffer(user)` retorna no máximo **uma** oferta para a Home, ou `null`. Regras em ordem de prioridade:

| Condição | Oferta | Onde aparece |
|---|---|---|
| Jornada concluída (dia 19 marcado) e sem assinatura | Círculo de São Miguel (mensal) | Modal ao concluir o dia 19 + card fixo na Home |
| 3 a 10 dias após concluir a jornada, sem assinatura | Plano anual com desconto | Card na Home + push único + e-mail (via cron) |
| Dia 10 a 18 da jornada | Trilha temática de 7 dias | Card na Home |
| Dia 2 a 9 da jornada | Novena avulsa | Card na Home |
| Não tem UP1/UP2 | Fica **bloqueado com cadeado na Loja** | Sempre visível na Loja, nunca na Home |

Registrar `offer_viewed` e `offer_clicked` em `events`. Uma oferta dispensada pelo usuário não volta por 7 dias.

## 10. Mural de intenções

- **Rezar** por uma intenção: todo usuário logado (1 vez por intenção; incrementa `prayer_count`).
- **Publicar** intenção: só com assinatura válida. Máximo de 1 por dia, 280 caracteres.
- Exibir só o **primeiro nome** e a data. Nunca e-mail, telefone ou sobrenome.
- Moderação: lista de palavras bloqueadas vira `pending`; botão "denunciar" e 3 denúncias deixam `hidden`; o admin aprova ou oculta.
- Notificação para o autor: "X pessoas rezaram pela sua intenção" (push agregado, no máximo 1 por dia).

## 11. Push

- Pedir permissão **só depois** do app instalado e com explicação na tela. No iOS, push só funciona com o PWA adicionado à tela inicial: o onboarding precisa de um passo visual "Compartilhar → Adicionar à Tela de Início".
- Cron de hora em hora: envia "oração do dia" para usuários cujo `prayer_hour` local é a hora atual.
- Remover `push_subscriptions` que retornarem 404/410.
- Chaves VAPID em secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).

## 12. PWA

- `manifest`: nome, ícones 192/512 + maskable, `display: standalone`, `theme_color`, `start_url: /`.
- Service worker: cache do shell do app (stale-while-revalidate). **Não** cachear áudios inteiros por padrão; oferecer "baixar para ouvir offline" apenas no áudio do dia.
- Tela de instalação com instruções diferentes para Android (prompt nativo `beforeinstallprompt`) e iOS (passo a passo manual).

## 13. Admin (`/admin`, atrás do Cloudflare Access)

- CRUD de produtos, programas e lições (upload de áudio/PDF para o R2).
- Busca de usuário por e-mail/telefone: ver entitlements, assinatura, progresso; conceder/revogar acesso manual (`source = 'manual'`).
- Fila de `payt_events` com erro ou marcados para revisão, com botão "reprocessar".
- Moderação do mural.
- Números básicos: compras por produto, assinantes ativos, churn do mês, conclusão da jornada por dia (funil D1 → D19).

## 14. Regras de conteúdo e compliance

- Textos do app (UI, descrição de produtos, push) **não prometem** dinheiro, cura ou resultado garantido. Linguagem devocional: "reze", "peça", "entregue sua intenção".
- Produtos ligados a saúde (Jornada de Cura, Manual de Purificação) exibem: *"Conteúdo devocional. Não substitui acompanhamento médico nem tratamento."*
- Página de **Política de Privacidade** e **Termos** (LGPD), com o CNPJ da empresa no rodapé.
- **Excluir conta** no Perfil: anonimiza o usuário (`deleted_at`, limpa e-mail, telefone e nome) e oculta as intenções dele.
- Suporte visível no Perfil (e-mail + WhatsApp).

## 15. Secrets e variáveis

```
PAYT_INTEGRATION_KEY
RESEND_API_KEY
MAIL_FROM
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
APP_URL
ENV = development | production
```

Bindings: `DB` (D1), `MEDIA` (R2).

## 16. Fases de entrega (um commit por item, testes passando)

1. **Scaffold**: Worker + Hono + Vite React + Tailwind + wrangler.toml + rota de health check + deploy de staging.
2. **Banco**: migration inicial (seção 5) + seed com a Jornada de 19 dias (lições placeholder) e os produtos do funil (front, UP1 como bundle, UP2 como bundle).
3. **Postback Payt**: endpoint + `entitlements.ts` + fixtures + testes da seção 7.
4. **Auth**: código por e-mail, sessão, e-mail de boas-vindas.
5. **Jornada**: Home, lista de dias, Player (áudio com Range + reflexão + "concluí"), regra de liberação diária.
6. **Loja**: listagem, página de produto, cadeado, link de checkout, polling pós-compra.
7. **Assinatura**: paywall, tela de assinatura no Perfil, conteúdo `requires_subscription`, modal do dia 19.
8. **Push + onboarding de instalação** (Android e iOS).
9. **Mural**.
10. **Ofertas contextuais + cron de D+3**.
11. **Admin**.
12. **Polimento PWA**: offline do shell, ícones, Lighthouse PWA sem erros.

## 17. Pendências a confirmar (perguntar ao Leo antes da fase correspondente)

- Payt: o checkout aceita pré-preenchimento de e-mail/nome via URL? (fase 6)
- Payt: assinatura aceita **Pix** (Pix Automático) ou só cartão? Isso muda o texto do paywall. (fase 7)
- Payt: o SKU dos produtos pode ser definido igual ao `products.id`? Se não, popular `product_payt_map`. (fase 3)
- Domínio do app e do remetente de e-mail (SPF/DKIM no Resend). (fase 4)
- Nome final do app e identidade visual. (fase 1, pode seguir com placeholder)

## 18. Convenções

- TypeScript `strict`. Validação de input com Zod em todas as rotas.
- SQL sempre com bind parameters; nunca concatenar.
- Datas em UTC no banco; conversão para fuso só na borda (regras de dia e push).
- Commits pequenos e descritivos, em português. Não misturar refactor com feature.
- Antes de dar uma fase por concluída: `npm run typecheck && npm test` sem erros.
