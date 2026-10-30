# CLAUDE.md — PWA devocional São Miguel

> Spec do projeto. Leia inteiro antes de qualquer tarefa. O app é a **Jornada com Meu Anjo** (nome curto **Meu Anjo**), em `jornadacomeuanjo.com`.

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
| Front | Vite + React + TypeScript + `vite-plugin-pwa` (manifest + service worker). **Sem biblioteca de rota**: `client/lib/rota.ts` resolve por `pathname` em poucas linhas, porque o app tem poucas telas e precisa abrir rápido em celular antigo. Se uma fase pedir mais (rota aninhada, carregamento por rota), a troca fica contida nesse arquivo |
| Build/dev | `@cloudflare/vite-plugin`: o Worker roda dentro do `vite dev` (mesma origem para API e client) e o build gera `dist/client` + `dist/jda_pwa` |
| Testes | Vitest + `@cloudflare/vitest-plugin` (sucessor do `@cloudflare/vitest-pool-workers`, que foi descontinuado) |
| Estilo | Tailwind |
| Banco | Cloudflare D1 (migrations em `migrations/`) |
| Arquivos | Cloudflare R2 (áudios MP3, PDFs, capas) servidos via Worker com checagem de acesso |
| E-mail | **Cloudflare Email Service** (binding `send_email`), remetente `contato@mail.jornadacomeuanjo.com`. Resend fica implementado como alternativa; o provedor sai da var `MAIL_PROVIDER` — o Email Sending está em beta, e trocar tem que ser variável + secret, sem deploy de código |
| Push | Web Push com VAPID, lib compatível com Workers (WebCrypto, ex.: `@block65/webcrypto-web-push`; validar antes) |
| Cron | Cron Triggers do Worker (push diário, ofertas D+3) |
| Admin | Rotas `/admin/*` protegidas por Cloudflare Access |

Sem Supabase, sem Next.js, sem servidor fora da Cloudflare.

### Ambientes e deploy

O ambiente é escolhido **no build**, não no deploy. `CLOUDFLARE_ENV=staging vite build`
resolve o `wrangler.toml` e grava `dist/jda_pwa/wrangler.json`; o `wrangler deploy`
publica esse arquivo. Passar `--env` no `wrangler deploy` é **ignorado** — quem manda
é a variável no build. Use sempre `npm run deploy:staging` / `npm run deploy:production`.

| Ambiente | Domínio | D1 | R2 |
|---|---|---|---|
| staging | `teste.jornadacomeuanjo.com` (+ `workers.dev`, por enquanto) | `jda-pwa-staging` | `jda-pwa-media-staging` |
| produção | `jornadacomeuanjo.com` e `www.` | `jda-pwa-prod` | `jda-pwa-media` |

Os dois são **Custom Domain do Worker**, declarados em `routes` no `wrangler.toml`
— o wrangler cria o registro de DNS no deploy. Custom Domain **recusa host que já
tenha registro A/CNAME** (`code: 100117`): o registro antigo sai primeiro.

**Staging mora num subdomínio do domínio de verdade, não no `workers.dev`.** Link
de e-mail apontando para `workers.dev` é sinal ruim de entrega: o domínio não bate
com o do remetente e é muito usado em golpe. Pelo mesmo motivo a raiz precisa
servir alguma coisa (§4, tela inicial) em vez de ficar estacionada.

**Staging não é indexável**: `robots.txt` com `Disallow: /` e `X-Robots-Tag:
noindex`, gerados no build (`vite.config.ts`), porque staging num subdomínio do
domínio real é uma cópia do app esperando para aparecer na busca. O `_headers`
vale só para asset estático — resposta de Worker (`/acesso`, `/parar`) leva o
cabeçalho no `src/worker/index.ts`, em todos os ambientes.

## 3. Estrutura de pastas

```
/
├─ src/
│  ├─ worker/            # Hono: index.ts, routes/, services/, lib/
│  │  ├─ routes/         # auth, me, programs, lessons, media, store, mural, push, payt, admin
│  │  ├─ services/       # entitlements.ts, payt.ts, push.ts, offers.ts, mail.ts
│  │  └─ cron.ts
│  ├─ client/            # React PWA
│  │  ├─ screens/        # Inicio, Entrar, Home, Programa, Licao, SemAcesso (Loja, Mural, Perfil nas fases seguintes)
│  │  ├─ components/     # Player, TextoMd
│  │  ├─ lib/            # api.ts, rota.ts (roteador próprio, por pathname)
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
(`price_cents`, `checkout_url`, `listed`, `sort`, `requires_subscription`), o
`payt_map` (`product.code` → produto) e o `payt_sku` (sku da Payt → produto).
Os dois valem em todos os ambientes e o seed só faz UPSERT neles.

**`payt_map` vs. mapeamento de teste.** O `product.sku` que a Payt manda é gerado
por ela (observado: `853b4781f48478` para a Jornada), não é o nosso `products.id`
— então o caminho normal de resolução é o `product_payt_map` pelo `product.code`.
São duas coisas diferentes:

| Onde | O quê | Vale em |
|---|---|---|
| `payt_map` no `seed/catalogo.json` | código real dos nossos produtos (ex.: `RVEEJ8` → `jornada-meu-anjo`) | todos os ambientes, inclusive produção |
| `product_payt_map` cadastrado à mão | código de um produto **que não é nosso**, usado só para testar o fluxo | só staging, nunca no seed |

Por isso o seed **nunca apaga** linha de `product_payt_map` que não esteja
declarada: uma limpeza derrubaria o mapeamento de teste do staging a cada rodada.

**Uma fonte por campo** — `scripts/seed-sql.ts` falha se um campo aparecer em duas:

- nome, descrição, aviso, lições e `bundle_id` dos itens de bundle → `seed/produtos.json`;
- produto, programa e as 19 lições da jornada → `seed/jornada-19-dias.json`;
- preço, checkout, ordem e assinatura → `seed/catalogo.json`;
- o nome dos bundles e das assinaturas também vem do catálogo, porque esses
  produtos não têm arquivo de conteúdo.

Os MP3 ficam em `audio/` e **não entram no git**: o destino é o R2, via
`npm run media:upload:staging`. O caminho local espelha o `audio_key` que vai para
o banco, e é esse `audio_key` que vira a chave no R2:

| Local | Chave no R2 (`audio_key`) |
|---|---|
| `audio/saida/dNN.mp3` | `jornada/dNN.mp3` |
| `audio/hino-sao-miguel.mp3` | `jornada/hino-sao-miguel.mp3` |
| `audio/saida/<produto>/lNN.mp3` | `<produto>/lNN.mp3` |

O script de upload monta a lista a partir dos mesmos JSON que o seed lê, então
chave no D1 e objeto no R2 não podem divergir. Lição cujo MP3 ainda não existe é
só avisada. A duração de cada lição é lida do MP3 local na hora de gerar o SQL.

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
jornadacomeuanjo.com sem sessão
  └─ Início: nome do app, uma frase sobre a jornada, "Entrar no meu app", suporte
      (com sessão, vai direto para a Home; links nossos caem direto em /entrar)

Acesso pós-compra (link do e-mail/WhatsApp)
  └─ Onboarding: login por código → instalar na tela inicial → ativar push → escolher horário
      └─ Home (oração do dia + card de oferta contextual)
          ├─ Jornada  → Player do dia (áudio + reflexão + "concluí")
          ├─ Loja     → Produto (prévia + botão de compra; itens bloqueados com cadeado)
          ├─ Mural    → Intenção (rezar por ela / contador "X pessoas rezaram")
          └─ Perfil   → Assinatura (status, próxima cobrança, link de gestão), horário de oração, sair, excluir conta
```

Bottom nav com 4 abas: Jornada, Loja, Mural, Perfil. Home é a tela inicial da aba Jornada.

A tela de **Início** é pública e existe por dois motivos: domínio que não serve
nada atrapalha a entrega do e-mail, e quem recebe o link precisa reconhecer onde
está antes de digitar o e-mail. Ela descreve o que o app tem, **sem promessa de
resultado** (§14). Quem chega por link nosso (`?e=` ou `?motivo=`) pula direto para
o login: já sabe onde está.

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
  purpose TEXT NOT NULL DEFAULT 'login',  -- 'login' | 'excluir_conta' | 'trocar_email'
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT,
  ip TEXT
);

CREATE TABLE access_links (          -- link do e-mail que já entra (§8)
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,   -- sha256 do token; o token em claro só vai no e-mail
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
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
  error TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0   -- fila do admin (seção 13)
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
- `diasDesde` conta **virada de dia no fuso do usuário**, não período de 24 h: quem
  começou às 23h abre o dia 2 à meia-noite e meia, não no dia seguinte às 23h.
- Não exige concluir o dia anterior (quem atrasa não fica travado), mas a UI destaca o "dia de hoje".
- `enrollment` é criado no primeiro acesso ao programa, não na compra. A Home
  **não** matricula: desenhar a tela não é começar a jornada.
- `GET /api/licoes/:id` confere o produto **e** o dia. Só o produto deixaria
  adivinhar a URL e ler o dia 19 no dia 1.
- Dia bloqueado sempre diz **quando abre** ("Libera amanhã", "Libera em X dias").
  Cadeado sem explicação faz a pessoa achar que o acesso falhou e pedir suporte.

### Player (fase 5)

- **`Range` é obrigatório no `/media/*`**, não enfeite: o player de áudio do iOS
  pede o arquivo em pedaços e **não toca** quem responde 200 com o arquivo inteiro.
- A chave do R2 **nunca** vai para o client: a lição devolve `/media/<chave>`, e o
  Worker confere que a chave pertence a uma lição antes de servir — senão bastaria
  pedir `/media/qualquer-coisa` para ler o bucket.
- **Media Session API** com título, contexto e `playbackState`, para o áudio seguir
  com a tela apagada e aparecer nos controles da tela de bloqueio e do fone.
- A posição de escuta fica em `localStorage`, por faixa: oração interrompida é
  regra, não exceção. É conveniência, então toda leitura e escrita vai em
  `try/catch` e a tela funciona sem ela.
- **`lesson_started` sai do evento `play` do áudio, não do clique no botão**:
  tocar pela tela de bloqueio ou pelo fone também é começar a oração.
  `audio_completed` sai acima de 90% da faixa, e `lesson_completed` só quando o
  progresso é **novo** — tocar "concluí" duas vezes não pode virar duas linhas no
  funil D1 → D19.
- A frase curta do dia vem do `summary`; faltando ele, do `**Intenção:**` do corpo.

## 7. Integração Payt (postback V1)

Endpoint: `POST /api/payt/postback`. Cadastrar na Payt em Ferramentas → Integrações → Postback, tipo **PayT V1**, **todos os eventos**.

### Processamento

1. Validar `integration_key` contra o secret `PAYT_INTEGRATION_KEY` (no corpo ou no header `x-integration-key`). Se não bater, responde 401 e **não grava nada**.
2. Gravar em `payt_events` com `dedupe_key`, **antes de qualquer validação de conteúdo** e com a `integration_key` mascarada como `"***"` (o segredo não fica guardado): o formato V1 real ainda não foi visto, e o primeiro postback de verdade precisa ficar inspecionável mesmo que o processamento quebre. Se for duplicado, responde 200 e para. Payload sem `transaction_id` entra com um ULID no `dedupe_key`, para não ser confundido com outro igualmente ilegível.
3. Se `test === true` e `ENV=production`, para por aqui (já está gravado).
4. Responder **200 rápido** e processar via `ctx.waitUntil`. Erro no processamento vai para `payt_events.error`, sem quebrar a resposta. **Se o postback é de venda paga, a falha também manda um e-mail de alerta para o `SUPPORT_EMAIL`** (`services/alerta-postback.ts`), com a transação, os status e o erro, **sem dado pessoal** (e-mail e sequência longa de dígitos saem do texto do erro). Venda paga sem acesso é cliente que pagou e ficou de fora: não pode depender de alguém ir olhar a fila.
5. Encontrar ou criar o usuário:
   - por `customer.email` (lowercase), exceto se `customer.fake_email === true`;
   - senão, por `customer.phone`.
6. Resolver produtos do pedido, **sku primeiro e code depois**: `product.sku` → `product_payt_sku`; `product.sku` → `products.id`; `product.code` → `product_payt_map`. Incluir `product.items` (grouped) e cada `order_bumps[].product`. Com os dois mapas, postback sem code ou relatório sem sku ainda resolvem: um identificador cobre o outro. O sku do relatório em `.xlsx` vem com prefixo (`6a44473d38700-853b4781f48478`); o mapa guarda só o pedaço depois do hífen, e a busca tenta as duas formas (`formasDoSku`).
7. Aplicar a tabela abaixo.

**O schema não recusa pedido por formato.** Só é obrigatório o que decide o acesso — `transaction_id`, `status`, `payment_status`, e-mail ou telefone do cliente e sku ou code do produto —, conferido no processamento com mensagem que diz o que faltou. Todo o resto é opcional e tolerante: ausente, null ou tipo trocado vira `undefined`. Em 28/10 um campo de relatório faltando (`link.query_params`) derrubou um upsell pago inteiro e o cliente ficou sem o acesso.

| Evento (status / transaction.payment_status) | Ação |
|---|---|
| `status = paid` e `payment_status = paid` (type order, upsell ou manual_upsell) | Conceder entitlement de cada produto resolvido. Se o usuário é novo, enviar e-mail de boas-vindas com link de acesso |
| `payment_status` em `refunded`, `chargeback`, `one_click_buy_refunded` | Revogar entitlements com aquele `transaction_id` |
| `payment_status` em `refunded_partial`, `one_click_buy_refunded_partial`, `chargeback_presented` | Não revogar automaticamente; registrar e marcar para revisão no admin |
| `subscription_activated`, `subscription_renewed`, `subscription_reactivated` | Upsert em `subscriptions` com `subscription.*` |
| `subscription_overdue` | Atualizar status para `overdue` (a carência vale pela regra da seção 6) |
| `subscription_canceled` | Atualizar status com `subscription.status` (ex.: `canceled_by_customer`) |
| `waiting_payment`, `lost_cart`, `canceled`, `expired` (Pix vencido), `refused` (cartão recusado) | Só registrar (futuro: recuperação). `expired` e `refused` são o dia a dia do checkout: na fila de revisão, só atrapalhariam |
| `refund_requested` | Só registrar. A revogação acontece quando chega o `refunded`; marcar revisão aqui encheria a fila com um item por reembolso |
| Qualquer outro status | Registrar e marcar `needs_review`: status que ninguém previu é como um formato diferente do esperado aparece |

`subscription.periodicity`: `1 month` vira `mensal`, `1 year` vira `anual`.

**Datas da Payt vêm em horário de Brasília e sem fuso** (`"2026-10-21 19:06:20.000000"`), observado no postback real. Normalizar para ISO UTC na borda com `paytParaIso` (§18). Data sem hora (`Y-m-d`) vira o **fim do dia** em Brasília: `next_charge_at` nesse formato decide até quando vale uma assinatura cancelada, e tratar como 00:00 tiraria do assinante o último dia pago.

### Testes obrigatórios

As fixtures em `fixtures/payt/` são **sintéticas**, montadas a partir desta seção — não são payloads reais (ver `fixtures/payt/README.md`). `npm run payt:last:staging` mostra os últimos postbacks gravados, para substituí-las pelo formato real depois da primeira compra de teste.

Usar `fixtures/payt/*.json`: pedido pago, pedido com order bump, upsell, reembolso, chargeback, ativação, renovação, atraso e cancelamento de assinatura, `fake_email`, postback duplicado, `integration_key` inválida. Rodar com Vitest + `@cloudflare/vitest-plugin`.

### Compra dentro do app

- Botão de compra abre `products.checkout_url` com `utm_source=app&utm_medium=loja&utm_campaign={product_id}`.
- **Pré-preenchimento confirmado**: o checkout aceita `?email=` e `&phone=`. O link sai com o e-mail da conta e, se ela tiver, o telefone; **sem `name`**, porque o checkout não pede. Mais que poupar digitação, é o que faz a compra cair **na mesma conta**: com outro e-mail, o postback cria outro usuário e o conteúdo não aparece para quem comprou.
- Depois do pagamento, o app faz polling leve de `/api/me/entitlements` (a cada 5 s por até 2 min) ao voltar para a aba, para liberar o produto sem precisar recarregar.

## 8. Autenticação

- Login por **código de 6 dígitos no e-mail**. Código com hash (sha256 do código + id do usuário), expira em 15 min, máximo de 5 tentativas.
- **A resposta de "pedir código" é sempre a mesma**, exista o e-mail ou não: senão o endpoint vira um verificador de quem é cliente.
- Limite de **5 pedidos por hora por e-mail e por IP**. Só por e-mail deixaria varrer uma lista; só por IP não protegeria um e-mail específico.
- Sessão em cookie `httpOnly; Secure; SameSite=Lax`, validade de **365 dias**, renovada a cada uso. O público é 55+: pedir e-mail de novo a cada três meses é atrito que faz desistir do app.
- **Link de acesso direto.** O e-mail de boas-vindas e o de campanha levam `/acesso?t={token}`, que entra sem digitar código. Token de 256 bits, guardado com **hash** (`access_links`), **uso único**, preso ao usuário e válido por **7 dias**.
  - A busca é pelo hash do token, sem id na URL: 256 bits sorteados não precisam de sal, diferente do código de 6 dígitos, que repete entre usuários.
  - **O GET não consome o token.** Outlook, Gmail e WhatsApp abrem link de mensagem sozinhos para checagem, e token de uso único gasto por robô deixa a pessoa de fora. O `GET /acesso` só mostra uma tela com um botão grande ("Toque no botão para entrar no app"); quem gasta o token é o `POST` do botão, que verificador de link não dispara porque não preenche formulário. **Sem envio automático por JavaScript** — a tela precisa abrir em qualquer navegador de e-mail, e script é justamente o que um pré-visualizador consegue imitar.
  - **A tela do GET é igual para token válido, vencido ou inventado**: ela nem consulta o banco. Dizer "este link venceu" antes do toque transformaria a página num verificador de token e vazaria o e-mail da conta. A diferença só aparece depois do toque.
  - Marcar como usado é um `UPDATE ... WHERE used_at IS NULL` e vale pelo número de linhas afetadas: é a reivindicação atômica do token, para dois toques ao mesmo tempo não virarem duas sessões.
  - Vencido, já usado ou desconhecido **cai na tela de login** com o e-mail preenchido e uma frase simples ("Este link já foi usado. Vamos te enviar um código."), nunca numa página de erro. Token desconhecido não preenche e-mail nenhum.
- **Ação sensível pede código mesmo com sessão aberta**: excluir a conta e trocar o e-mail. O código vai para o e-mail **atual** da conta — é o acesso àquela caixa que prova que é a pessoa; mandar para o endereço novo deixaria um celular destravado virar perda de conta. `login_codes.purpose` separa os códigos: o de login não autoriza exclusão, e o de exclusão não abre sessão.
- **A tela de código é feita para 55+**: um passo por tela, letra grande, `autocomplete="one-time-code"` e `inputmode="numeric"`, e o aviso "Não chegou? Confira a pasta Spam ou Lixo eletrônico" **visível desde o início**, com o botão de reenviar logo abaixo. O reenvio respeita o limite de 5 por hora e, no limite, oferece o suporte em vez de um botão que não funciona.
- Usuário com `fake_email`: login por telefone, com o código enviado por WhatsApp (**fase 2**; no MVP, contato manual pelo suporte).
- Quem entra sem nenhum produto ativo **vê uma tela explicando** (compra processando, e-mail diferente, reembolso) com o contato do suporte — não um erro.
- Todo envio de e-mail vira linha em `events` (`email_enviado` / `email_falhou`) com tipo, provedor e erro. **Nunca o código.** Falha de código de login sai no log como `[EMAIL][FALHA CRITICA]`: deixa alguém de fora do app.

### Como os e-mails são escritos

O modelo é markdown (`src/worker/emails/*.md`); o HTML sai de `emails/layout.ts`.
**Quem escreve o modelo não escreve HTML**: tag crua é removida das duas versões.

- **Documento completo**: `<!doctype html>`, `<html lang="pt-BR">`, `<head>` com
  charset e viewport, `<body>` com cor de fundo própria.
- **Uma coluna de 600px, em tabela, com estilo inline em cada elemento.** Boa
  parte da base lê no Outlook, que renderiza com o motor do Word: flex, grid e
  `<style>` no `<head>` não valem lá.
- **Corpo em 19px com entrelinha 1.65.** Letra grande é requisito do público, não
  estética. Nada abaixo de 15px, nem no rodapé.
- **Sem imagem**: imagem bloqueada por padrão deixaria o e-mail sem sentido, e
  peso de imagem conta contra a reputação de quem começou a enviar agora.
- **A versão `text/plain` não tem nenhuma tag.** Era o bug que fazia sair
  `<small>` literal para quem lê em texto puro.
- `:destaque: {{codigo}}` vira o bloco grande do código de login, e um link
  sozinho na linha (`[ Entrar ](url)`) vira botão.

### E-mail: remetente, resposta e cota

- O app envia **só** por `contato@mail.jornadacomeuanjo.com`. O domínio principal
  (`jornadacomeuanjo.com`) fica habilitado para outro uso — responder cliente como
  `suporte@` pelo Gmail — e **o app não envia por ele**.
- Todos os e-mails do app (login, boas-vindas e campanha) saem com
  **`Reply-To: suporte@jornadacomeuanjo.com`**, nos dois provedores. Esse endereço
  é do Email Routing e encaminha para a caixa do Leo.
- **O suporte responde como `suporte@jornadacomeuanjo.com`** pelo "Enviar e-mail
  como" do Gmail, desde 28/10, usando o **SMTP do Cloudflare Email Service**
  (`smtp.mx.cloudflare.net:465`, usuário `api_token`). A senha é um token próprio,
  com permissão **só de Email Sending**, e fica guardada **só no Gmail** — não está
  no wrangler, no `.dev.vars` nem em lugar nenhum do projeto; se vazar ou for
  perdido, gera-se outro no painel da Cloudflare e troca-se no Gmail. SPF, DKIM e
  DMARC passaram no teste. É envio humano, não do app: o app continua mandando só
  por `contato@mail.`.
- **Cota de 1.000 envios por dia**, da conta inteira. A campanha reserva **300**
  para o transacional e nunca encosta nessa fatia: ficar sem cota de login deixaria
  cliente fora do app. **O transacional são login, boas-vindas e as respostas do
  suporte**, que saem da mesma cota. Só que o app conta o que enviou pelo `events`
  (`enviadosHoje`), e a resposta do Gmail não passa por ele: **ela consome a reserva
  sem aparecer na conta**. Em dia de muito atendimento, a reserva de 300 é o que
  protege o login — não reduzir.

## 9. Ofertas contextuais (`services/offers.ts`)

Uma função `getOffer(user)` retorna no máximo **uma** oferta para a Home, ou `null`. Regras em ordem de prioridade:

| Condição | Oferta | Onde aparece |
|---|---|---|
| Jornada concluída (dia 19 marcado) e sem assinatura | Círculo de São Miguel (mensal) | Modal ao concluir o dia 19 + card fixo na Home |
| 3 a 10 dias após concluir a jornada, sem assinatura | Plano anual com desconto | Card na Home + push único + e-mail (via cron) |
| Dia 10 a 18 da jornada, sem o UP2 | **UP2**, Jornada de Cura com Padre Pio (`jornada-cura-padre-pio`), com o aviso de saúde do §14 | Card na Home |
| Dia 5 a 9 da jornada, sem o UP1 | **UP1**, Oração de São Miguel do Monte Gargano (`oracao-sao-miguel`) | Card na Home |
| Dias 1 a 4, ou sem matrícula | **Nada**: a primeira impressão é a oração, não a venda | — |
| Não tem UP1/UP2 | Fica **bloqueado com cadeado na Loja** e, na janela dele, aparece no card da Home | Loja sempre; Home só na janela |

Os pacotes **deixaram de ser "nunca na Home"** (28/10). O dia é o mesmo "dia de hoje" do lembrete, `min(dias corridos + 1, 19)` desde a matrícula, no fuso da pessoa. Quem já tem o pacote (`hasAccess` no bundle) não vê o card dele; quem tem os dois não vê card nenhum. O card fica **abaixo do cartão da oração do dia, nunca acima**, e **sem push de oferta**. O toque abre a página do pacote na Loja com `?origem=home`, e o checkout sai com `utm_medium=home` — é o que o `purchase_from_app` (campo `canal`) usa para separar a venda da Home da venda da Loja. "Agora não" grava `offer_dismissed` no servidor e esconde **aquele pacote** por 7 dias, em qualquer aparelho. A Trilha temática (dias 10 a 18) e a Novena avulsa (dias 2 a 9), que ocupavam essas janelas, saíram da tabela: os produtos ainda não existem, e quando existirem a ordem entre eles e os pacotes precisa ser decidida.

Registrar em `events`: `offer_viewed` (uma vez por dia e por pacote, no fuso da pessoa), `offer_clicked` e `offer_dismissed`. Uma oferta dispensada pelo usuário não volta por 7 dias.

## 10. Mural de intenções

- **Rezar** por uma intenção: todo usuário logado (1 vez por intenção; incrementa `prayer_count`).
- **Publicar** intenção: só com assinatura válida. Máximo de 1 por dia, 280 caracteres.
- Exibir só o **primeiro nome** e a data. Nunca e-mail, telefone ou sobrenome.
- **O formulário avisa antes, não depois** (fase 9), junto do campo de texto:
  > Sua intenção aparece para os outros usuários com o seu primeiro nome. Não
  > escreva sobrenome, telefone ou dados de saúde de outras pessoas.

  O mural é o único lugar do app onde o usuário escreve em público, e o risco não
  é o dado dele: é o da mãe doente, que não escolheu aparecer ali. Moderação
  depois não desfaz o que já foi lido, então o aviso fica **antes** de escrever.
- Moderação: lista de palavras bloqueadas vira `pending`; botão "denunciar" e 3 denúncias deixam `hidden`; o admin aprova ou oculta.
- Notificação para o autor: "X pessoas rezaram pela sua intenção" (push agregado, no máximo 1 por dia).

## 11. Push

- Pedir permissão **só depois** do app instalado e com explicação na tela, e **só no toque do botão**: permissão negada no impulso não volta mais — o navegador não pergunta de novo, e a pessoa teria que achar o ajuste no sistema.
- No iOS, push só funciona com o PWA adicionado à tela inicial (16.4+), então **instalar vem antes de pedir** — pedir antes seria pedir o que o aparelho não tem como dar. No Android o push funciona no navegador também.
- **Estado do aparelho fica no aparelho** (`localStorage` com `try/catch` + `pushManager.getSubscription()`): instalou, dispensou, permissão. **Horário e fuso são da conta** e ficam no banco, para quem troca de celular não perder o que escolheu.
- O onboarding em tela cheia roda **uma vez por aparelho**; depois quem convida é um card na Home, dispensável por 7 dias. Cada tela tem **uma ação só** e o "Agora não" sempre visível. "Agora não" **encerra** o onboarding em vez de emendar o passo seguinte: emendar logo depois de um "não" é ignorar a resposta.
- **No Android, o card do lembrete não depende de instalar.** O push funciona no Chrome sem o app instalado, e há Chrome que nem oferece "Instalar app" (visto no BlueStacks): prender o convite à instalação deixava essa pessoa sem lembrete nenhum, e é ele que traz de volta todo dia. Então, no Android, o card "Ligar o lembrete" aparece também fora do modo standalone, com a permissão em `default`, e **vem antes** do de instalar quando os dois valem. Tocar na notificação sem o app instalado abre a oração no Chrome, e está bem assim. No iPhone nada muda (fora da tela inicial não há push), e o onboarding em tela cheia segue na ordem de sempre: instalar primeiro.
- Ao escolher o horário, o app manda **na hora** um push de confirmação. É ele que prova a corrente inteira — permissão, assinatura, serviço de push e service worker — enquanto a pessoa ainda está na tela.
- Permissão concedida e sem assinatura neste aparelho (reinstalou, limpou dados): **assina de novo em silêncio**. A pessoa já disse sim.
- **Cron a cada 5 minutos**, não de hora em hora: envia a "oração do dia" para quem está na hora, no fuso de cada um. O horário padrão é 7h e quase todo mundo fica nele — uma execução por hora juntaria a base inteira numa só, e execução de Worker tem limite de tempo e de subrequisições. Cada execução pega um lote (`LOTE`, 300).
- **A trava contra lembrete repetido é `push_envios`**, com `(user_id, tipo, data_local)` de chave: a linha entra **antes** do envio, com `INSERT OR IGNORE`, e só envia quem conseguiu inserir. Duas execuções sobrepostas disputam a mesma chave e só uma ganha. `data_local` é o dia **no fuso do usuário**: em Brasília o dia vira três horas antes do dia UTC.
- Quem recebe: está na hora, tem assinatura de push, tem acesso à jornada e **ainda não concluiu o dia de hoje**. Sem matrícula, o lembrete convida para o dia 1 e **não matricula** — o relógio da jornada começa quando a pessoa entra no programa (§6). Para de lembrar 7 dias depois de o dia 19 abrir; o que vem depois é da fase 10.
- Notificação com `tag: 'oracao-do-dia'`: um lembrete **substitui** o anterior em vez de empilhar na tela de quem passou dias sem abrir.
- Remover `push_subscriptions` que retornarem 404/410. Erro passageiro não apaga nada.
- `events` de push guarda **só o serviço** (fcm, apple…), nunca o endpoint: ele é credencial de entrega, não dado de relatório.
- O endpoint da assinatura só é aceito se for https e de um serviço conhecido. Sem essa lista, quem grava uma assinatura usa o Worker para disparar POST para qualquer URL.
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
- **O rodapé dos e-mails não leva dado de empresa** — só o nome do app e o motivo
  de a pessoa estar recebendo aquele e-mail ("porque pediu um código", "porque
  sua compra foi confirmada", "porque comprou a Jornada"). Razão social e CNPJ
  ficam na página de privacidade. Quem identifica o remetente no e-mail é o nome
  do remetente e o `Reply-To` do suporte. O e-mail de campanha continua levando o
  link de "parar de receber" nesse mesmo rodapé.
- **Excluir conta** no Perfil: anonimiza o usuário (`deleted_at`, limpa e-mail, telefone e nome) e oculta as intenções dele.
  - **Até a tela de Perfil existir (fase 7), a exclusão é feita pelo suporte**:
    `npm run conta:excluir -- --email X --env production`. Sem `--confirmar` ele
    só mostra o que seria apagado — a exclusão não tem volta, e e-mail digitado
    errado apaga a conta de outra pessoa.
  - **Fase 7**: o fluxo de exclusão (script e tela) **avisa quando existe
    assinatura válida**, porque excluir a conta aqui **não cancela a cobrança na
    Payt** — a pessoa continuaria pagando por um acesso que deixou de existir.
    Cancelar é no painel da Payt, antes. O script já dá esse aviso; a tela do
    Perfil precisa dar também, e de forma que não dê para passar batido.
- Suporte visível no Perfil (e-mail + WhatsApp).
- **Campanha de e-mail** (aviso de novidade, promoção) leva link de "parar de receber" assinado por HMAC, sem exigir login; marca `users.marketing_opt_out_at`. Quem opta por sair **continua recebendo** código de login e e-mail de compra, que são transacionais. Cada envio fica em `campaign_sends`, com chave única por campanha e usuário: nunca reenvia. O anúncio tem **dois modelos** (`--modelo curto` lê `conteudo/emails/anuncio-app-curto.md`; sem a opção, o `anuncio-app.md`), com a mesma chave de campanha — quem recebeu um nunca recebe o outro — e o modelo gravado em `campaign_sends.model` para comparar. O link do curto fica dentro da frase, de propósito: não vira botão. **Quem já recebeu o e-mail de boas-vindas fica fora da campanha**: comprou depois do postback e já tem o link (boas-vindas que falhou não conta).
- Domínio de envio novo sobe volume em ondas (50, 100, 250, 500, 1.000/dia). O disparo recusa limite maior que o dobro da onda anterior e para sozinho acima de 5% de falha. O Worker envia um por um dentro de uma requisição, então o script manda a onda **em lotes de até 40**, depois de um dry-run com o total que deixa o Worker conferir a trava e a cota: uma chamada só com 200 estourou o timeout de 300 s do `fetch`, e a Cloudflare corta o Worker quando o cliente cai.
- **Ordem das ondas**: compra mais recente primeiro — quem comprou há pouco lembra da marca e reclama menos de receber. `--provedores gmail` põe um provedor na frente da fila (a data desempata dentro dele, e quem não está na lista vai para o fim, sem sair da seleção). Serve para subir reputação onde ela já existe: o Gmail entrega na caixa de entrada desde o primeiro dia e o Outlook manda para o lixo eletrônico enquanto o domínio é novo. A data de compra vem do `granted_at` do entitlement, que a importação do CSV preenche com a data da venda — não com a data da importação, senão a ordem não diria nada.

## 15. Secrets e variáveis

**Secrets** (`wrangler secret put`, nunca em arquivo):

```
PAYT_INTEGRATION_KEY           # SÓ o /api/payt/postback
ADMIN_API_KEY                  # rotas administrativas, header x-admin-key
CAMPAIGN_SIGNING_KEY           # assina o link de "parar de receber"
RESEND_API_KEY                 # só se MAIL_PROVIDER=resend
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
```

**As credenciais são separadas de propósito.** A `PAYT_INTEGRATION_KEY` é
conhecida por terceiro — a Payt a manda no corpo de todo postback. Se ela também
administrasse, quem tem o segredo do postback poderia reprocessar evento, liberar
acesso e disparar e-mail para a base. Por isso reprocesso, campanha e concessão
manual usam a `ADMIN_API_KEY` no header `x-admin-key`.

Gere e grave **sem passar pela tela** — e **no Git Bash, não no PowerShell**:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put ADMIN_API_KEY --env staging
```

O shell importa. **O pipe do PowerShell reescreve o texto em UTF-8 com BOM**, e o
U+FEFF entra no segredo — foi assim que o `VAPID_PUBLIC_KEY` do staging nasceu
com 88 caracteres em vez de 87 e derrubou o `subscribe` do iPhone com
`InvalidCharacterError`. O Git Bash passa os bytes como estão. O
`process.stdout.write` em vez de `console.log` é pelo mesmo motivo: não
acrescenta a quebra de linha no fim.

Os scripts leem a chave administrativa do ambiente ou de uma cópia no
`.dev.vars`, que está fora do git. **Uma cópia por ambiente**: `ADMIN_API_KEY`
para staging e `ADMIN_API_KEY_PRODUCTION` para produção (`chaveAdmin` em
`scripts/lib/segredos.ts`). No Worker o nome é `ADMIN_API_KEY` nos dois; o nome
separado é só da cópia local, para guardar uma não apagar a outra.

Para produção, a receita grava o wrangler e a cópia local de uma vez, sem a
chave passar pela tela:

```bash
node -e "const k=require('crypto').randomBytes(32).toString('hex'); require('fs').appendFileSync('.dev.vars', '\nADMIN_API_KEY_PRODUCTION='+k+'\n'); process.stdout.write(k)" | npx wrangler secret put ADMIN_API_KEY --env production
```

Rede de segurança, não substituto da receita: todo segredo do Worker é lido por
`src/worker/lib/segredos.ts` e todo segredo dos scripts por
`scripts/lib/segredos.ts`. Os dois tiram BOM e espaço das pontas, para a
próxima chave gravada torta não virar outra caçada.

**Vars** (no `wrangler.toml`, não são segredo):

```
ENV = development | production
APP_URL
MAIL_PROVIDER = cloudflare | resend
MAIL_FROM = contato@mail.jornadacomeuanjo.com
MAIL_FROM_NAME
SUPPORT_EMAIL = suporte@jornadacomeuanjo.com
```

Bindings: `DB` (D1), `MEDIA` (R2), `EMAIL` (send_email).

O domínio de envio é `mail.jornadacomeuanjo.com`, habilitado no Email Sending.
**Sem essa habilitação o binding só entrega para endereço verificado** — o erro é
`destination address is not a verified address`.

DNS do subdomínio de envio: SPF, DKIM (`cf-bounce._domainkey`) e DMARC. O DMARC
fica em **`p=none`** enquanto o domínio é novo: `p=reject` em domínio sem
reputação derruba e-mail legítimo sem deixar rastro de diagnóstico. O domínio
principal fica em `p=reject`, por decisão do Leo.

O `rua` dos relatórios não aponta mais para o suporte: quem lê relatório DMARC é
o **DMARC Management da Cloudflare**, e caixa de suporte recebendo XML de
relatório só atrapalha o atendimento. O DMARC Management **só funciona em domínio
apex** — em `mail.` o `rua` da Cloudflare entra à mão.

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

### Compra de teste

**Nunca usar e-mail aleatório em compra de teste.** Sempre um endereço próprio.
Um endereço inventado pode existir de verdade: a pessoa recebe e-mail do app,
vira usuário no banco e os dados dela ficam no `payt_events`. Aconteceu uma vez,
e a limpeza exigiu apagar o usuário de todas as tabelas e mascarar o payload.

## 17. Pendências a confirmar (perguntar ao Leo antes da fase correspondente)

- ~~Payt: o checkout aceita pré-preenchimento?~~ Sim: `?email=` e `&phone=`, sem nome (§7).
- Payt: assinatura aceita **Pix** (Pix Automático) ou só cartão? Isso muda o texto do paywall. (fase 7)
- Payt: o SKU dos produtos pode ser definido igual ao `products.id`? Se não, popular `product_payt_map`. (fase 3)
- ~~Domínio do app e do remetente de e-mail~~: `jornadacomeuanjo.com`, envio por
  `contato@mail.jornadacomeuanjo.com`, suporte em `suporte@jornadacomeuanjo.com`.
- ~~Nome final do app~~: **Jornada com Meu Anjo**, nome curto **Meu Anjo**, domínio
  `jornadacomeuanjo.com`. Falta só a identidade visual (ícones ainda são placeholder).
- ~~Payt: o SKU pode ser igual ao `products.id`?~~ **Não**: a Payt gera o sku
  (observado `853b4781f48478`). A resolução normal é pelo `payt_map` com o
  `product.code` — cada produto do funil precisa do código dele lá antes da produção.

## 18. Convenções

- TypeScript `strict`. Validação de input com Zod em todas as rotas.
- SQL sempre com bind parameters; nunca concatenar.
- Datas em UTC no banco; conversão para fuso só na borda (regras de dia e push).
- Commits pequenos e descritivos, em português. Não misturar refactor com feature.
- Antes de dar uma fase por concluída: `npm run typecheck && npm test` sem erros.
- **Push sem perguntar** (decisão do Leo, 28/10): terminado um item com `npm run typecheck && npm test` passando, os commits vão para o `origin/main` na hora. Isso vale só para o push: publicar em produção continua dependendo do que o Leo pediu.
