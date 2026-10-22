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
| Front | Vite + React + TypeScript + `vite-plugin-pwa` (manifest + service worker) |
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
(`price_cents`, `checkout_url`, `listed`, `sort`, `requires_subscription`) e o
`payt_map`.

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
- Não exige concluir o dia anterior (quem atrasa não fica travado), mas a UI destaca o "dia de hoje".
- `enrollment` é criado no primeiro acesso ao programa, não na compra.

## 7. Integração Payt (postback V1)

Endpoint: `POST /api/payt/postback`. Cadastrar na Payt em Ferramentas → Integrações → Postback, tipo **PayT V1**, **todos os eventos**.

### Processamento

1. Validar `integration_key` contra o secret `PAYT_INTEGRATION_KEY` (no corpo ou no header `x-integration-key`). Se não bater, responde 401 e **não grava nada**.
2. Gravar em `payt_events` com `dedupe_key`, **antes de qualquer validação de conteúdo** e com a `integration_key` mascarada como `"***"` (o segredo não fica guardado): o formato V1 real ainda não foi visto, e o primeiro postback de verdade precisa ficar inspecionável mesmo que o processamento quebre. Se for duplicado, responde 200 e para. Payload sem `transaction_id` entra com um ULID no `dedupe_key`, para não ser confundido com outro igualmente ilegível.
3. Se `test === true` e `ENV=production`, para por aqui (já está gravado).
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
| `refund_requested` | Só registrar. A revogação acontece quando chega o `refunded`; marcar revisão aqui encheria a fila com um item por reembolso |
| Qualquer outro status | Registrar e marcar `needs_review`: status que ninguém previu é como um formato diferente do esperado aparece |

`subscription.periodicity`: `1 month` vira `mensal`, `1 year` vira `anual`.

**Datas da Payt vêm em horário de Brasília e sem fuso** (`"2026-10-21 19:06:20.000000"`), observado no postback real. Normalizar para ISO UTC na borda com `paytParaIso` (§18). Data sem hora (`Y-m-d`) vira o **fim do dia** em Brasília: `next_charge_at` nesse formato decide até quando vale uma assinatura cancelada, e tratar como 00:00 tiraria do assinante o último dia pago.

### Testes obrigatórios

As fixtures em `fixtures/payt/` são **sintéticas**, montadas a partir desta seção — não são payloads reais (ver `fixtures/payt/README.md`). `npm run payt:last:staging` mostra os últimos postbacks gravados, para substituí-las pelo formato real depois da primeira compra de teste.

Usar `fixtures/payt/*.json`: pedido pago, pedido com order bump, upsell, reembolso, chargeback, ativação, renovação, atraso e cancelamento de assinatura, `fake_email`, postback duplicado, `integration_key` inválida. Rodar com Vitest + `@cloudflare/vitest-plugin`.

### Compra dentro do app

- Botão de compra abre `products.checkout_url` com `utm_source=app&utm_medium=loja&utm_campaign={product_id}`.
- **A confirmar na Payt:** se o checkout aceita pré-preenchimento de nome/e-mail por query param. Se aceitar, preencher com os dados do usuário logado para reduzir atrito.
- Depois do pagamento, o app faz polling leve de `/api/me/entitlements` (a cada 5 s por até 2 min) ao voltar para a aba, para liberar o produto sem precisar recarregar.

## 8. Autenticação

- Login por **código de 6 dígitos no e-mail**. Código com hash (sha256 do código + id do usuário), expira em 15 min, máximo de 5 tentativas.
- **A resposta de "pedir código" é sempre a mesma**, exista o e-mail ou não: senão o endpoint vira um verificador de quem é cliente.
- Limite de **5 pedidos por hora por e-mail e por IP**. Só por e-mail deixaria varrer uma lista; só por IP não protegeria um e-mail específico.
- Sessão em cookie `httpOnly; Secure; SameSite=Lax`, validade de **365 dias**, renovada a cada uso. O público é 55+: pedir e-mail de novo a cada três meses é atrito que faz desistir do app.
- **Link de acesso direto.** O e-mail de boas-vindas e o de campanha levam `/acesso?t={token}`, que já abre a sessão — quem acabou de comprar não digita código nenhum. Token de 256 bits, guardado com **hash** (`access_links`), **uso único**, preso ao usuário e válido por **7 dias**.
  - A busca é pelo hash do token, sem id na URL: 256 bits sorteados não precisam de sal, diferente do código de 6 dígitos, que repete entre usuários.
  - Marcar como usado é um `UPDATE ... WHERE used_at IS NULL` e vale pelo número de linhas afetadas: é a reivindicação atômica do token, porque leitor de link de e-mail abre o link antes da pessoa.
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
- **Cota de 1.000 envios por dia**, da conta inteira. A campanha reserva **300**
  para o transacional (login e boas-vindas) e nunca encosta nessa fatia: ficar sem
  cota de login deixaria cliente fora do app.

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
- **O rodapé dos e-mails não leva dado de empresa** — só o nome do app e o motivo
  de a pessoa estar recebendo aquele e-mail ("porque pediu um código", "porque
  sua compra foi confirmada", "porque comprou a Jornada"). Razão social e CNPJ
  ficam na página de privacidade. Quem identifica o remetente no e-mail é o nome
  do remetente e o `Reply-To` do suporte. O e-mail de campanha continua levando o
  link de "parar de receber" nesse mesmo rodapé.
- **Excluir conta** no Perfil: anonimiza o usuário (`deleted_at`, limpa e-mail, telefone e nome) e oculta as intenções dele.
- Suporte visível no Perfil (e-mail + WhatsApp).
- **Campanha de e-mail** (aviso de novidade, promoção) leva link de "parar de receber" assinado por HMAC, sem exigir login; marca `users.marketing_opt_out_at`. Quem opta por sair **continua recebendo** código de login e e-mail de compra, que são transacionais. Cada envio fica em `campaign_sends`, com chave única por campanha e usuário: nunca reenvia.
- Domínio de envio novo sobe volume em ondas (50, 100, 250, 500, 1.000/dia). O disparo recusa limite maior que o dobro da onda anterior e para sozinho acima de 5% de falha.

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

Gere e grave sem passar pela tela:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   | npx wrangler secret put ADMIN_API_KEY --env staging
```

Os scripts leem a `ADMIN_API_KEY` do ambiente ou de uma cópia no `.dev.vars`,
que está fora do git.

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

- Payt: o checkout aceita pré-preenchimento de e-mail/nome via URL? (fase 6)
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
