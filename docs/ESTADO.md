# Estado do projeto — 22/10/2026

Retrato para uma sessão nova continuar daqui. A spec é o [CLAUDE.md](../CLAUDE.md);
este arquivo registra o que **não** cabe lá: o que já rodou, o que está só em
staging, o que depende do Leo e as armadilhas que custaram caro.

Último commit: o desta sessão — ajustes de e-mail e de login para o público 55+.
`npm run typecheck && npm test` limpo, **151 testes** em 9 arquivos. Staging no ar
em **https://jda-pwa-staging.leonardovcs2022.workers.dev**.

---

## 1. Fases

| Fase | Situação |
|---|---|
| 1 — Scaffold | **concluída** |
| 2 — Banco | **concluída** |
| 3 — Postback Payt | **concluída e validada com a Payt de verdade** |
| 4 — Auth | **concluída**, com e-mail entregando. Revisada 22/10 para o público 55+: link de acesso direto, sessão de 1 ano, código em ação sensível, tela de código mais fácil |
| 5 — Jornada | **não começou** ← próxima |
| 6 a 12 | não começaram |

### Fora do escopo das fases, já construído

A **campanha de anúncio do app** (importador da base, disparo em ondas, opt-out,
exportação de quem não tem e-mail) foi construída adiantada, a pedido. Está
pronta e testada, mas **nunca foi disparada para ninguém além dos dois e-mails
de teste**. O texto é do pipeline de conteúdo (`conteudo/emails/anuncio-app.md`).

### O que ficou de fora de propósito

- **Fase 5 em diante**: nada da jornada, player, loja, mural, push ou admin.
  O client hoje tem só: login, tela de "sem acesso" e uma lista dos produtos
  liberados. `App.tsx` diz "A jornada começa aqui em breve".
- **Login por WhatsApp** para `fake_email` (§8): continua fase 2, como a spec diz.
- **Produção**: o Worker de produção **nunca foi publicado**. Não há D1, R2 nem
  secrets lá. `wrangler.toml` ainda tem `TROCAR_PELO_ID_DO_D1_PROD`.

---

## 2. Decisões que não estão no CLAUDE.md

**Rotas administrativas são interinas.** `/api/payt/reprocess`,
`/api/campanha/enviar` e `/api/admin/conceder` existem porque os scripts de
operação precisam do banco e do envio de e-mail, que só o Worker tem. Elas usam
`ADMIN_API_KEY` no header `x-admin-key`. Na fase 11 o admin entra atrás do
Cloudflare Access (§13) e **estas rotas saem**.

**O reprocesso recusa rodar em produção.** Reprocessar sem revisão humana pode
conceder acesso a partir de um payload que foi recusado por motivo legítimo.

**`vitest` roda em dois projetos.** `node` (validação do gerador de seed, que usa
`node:fs`) e `workers` (o resto). O validador não roda no runtime do Workers.

**O client não tem roteador.** `App.tsx` é uma máquina de estados simples
(carregando → deslogado → logado). `/entrar?e=...` é lido do `location.search`.
Quando a fase 5 trouxer abas, provavelmente vai precisar de um.

**Node 24 roda `.ts` direto.** Os scripts em `scripts/` são TypeScript sem build,
executados por `node scripts/x.ts`. Por isso `allowImportingTsExtensions` no
`tsconfig.node.json` e os imports com `.ts` explícito.

**Markdown dos e-mails vira string pelo bundler** (`?raw`), porque o Worker não lê
disco. O renderizador (`src/worker/emails/render.ts`) cobre só o subconjunto que
os e-mails usam: parágrafo, negrito, link, lista, citação e HTML cru.

---

## 3. Secrets

Só os nomes. Os valores vivem no wrangler; `ADMIN_API_KEY` e
`CAMPAIGN_SIGNING_KEY` têm cópia local no `.dev.vars`, que está no `.gitignore`.

### Staging — cadastrados

```
PAYT_INTEGRATION_KEY     # só o /api/payt/postback
ADMIN_API_KEY            # reprocesso, campanha, concessão manual
CAMPAIGN_SIGNING_KEY     # assina o link de "parar de receber"
```

### Staging — ainda faltam

```
RESEND_API_KEY           # só se MAIL_PROVIDER virar "resend"
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT   # fase 8
```

### Produção — nenhum

O Worker de produção não existe ainda. Quando existir, todos acima precisam ser
cadastrados com `--env production`, e **os valores devem ser diferentes dos de
staging**.

---

## 4. Staging: o que existe lá e não vai para produção

### Usuários de teste (3)

| E-mail | Acesso | Como |
|---|---|---|
| `leonardovcs2022@gmail.com` | `jornada-meu-anjo` | `grant:staging`, `source = 'manual'` |
| `anacacancelli@outlook.com` | `jornada-meu-anjo` | idem (criado 22/10 para medir entrega no Outlook) |
| `lenzincamara@hotmail.com` | `jornada-meu-anjo` | idem — **não use mais para medir entrega** |

Entitlement manual não tem `transaction_id`, então **reembolso da Payt não o
revoga** — sobrevive aos testes de reembolso.

O `lenzincamara@hotmail.com` foi marcado à mão como "não é lixo" na caixa, então
ele passa a entregar na entrada independente da reputação do domínio: deixou de
medir o que interessa. Quem mede o Outlook agora é o `anacacancelli@outlook.com`,
**enquanto ninguém mexer na pasta dele**.

Nenhum dos três tem `name` gravado, então os e-mails chegam com "Olá!" e o
assunto do anúncio sem nome — é o caminho que a base antiga sem nome vai usar.

O `grant:staging` **não cria usuário**: ele responde `usuario_nao_encontrado` se
o e-mail não existe. A linha da Ana foi inserida à mão antes do grant.

### `product_payt_map` no staging

```
RVEEJ8 -> jornada-meu-anjo   # REAL, vem do seed, vale em produção
LJ7KEP -> jornada-meu-anjo   # SÓ STAGING, cadastrado à mão, nunca em produção
```

`LJ7KEP` é o código do **"60 Receitas - Saladas No Pote"**, um produto que não é
nosso, usado só para exercitar o fluxo de compra. Em produção, mapear o código de
um produto para outro daria acesso errado a quem comprou. Por isso o seed só faz
`UPSERT` em `product_payt_map` e **nunca apaga** o que não está declarado — uma
limpeza derrubaria esse mapeamento a cada rodada.

### Tokens de acesso em staging

A tabela `access_links` tem 2 tokens, dos e-mails de anúncio de teste (um por
destinatário). São de uso único: se a pessoa já clicou, o link cai na tela de
login com o e-mail preenchido — que é o comportamento esperado, não um defeito.

### Outros dados

4 eventos em `payt_events` (o ciclo completo da compra de teste: aguardando →
pago → reembolso pedido → reembolsado), todos com a `integration_key` mascarada e
os dados do cliente anonimizados. `campaign_sends` vazia.

---

## 5. Resultado do teste de e-mail (22/10/2026)

Envio pelo Cloudflare Email Service, remetente `contato@mail.jornadacomeuanjo.com`.

| Destino | Autenticação | Caixa |
|---|---|---|
| Gmail | **SPF, DKIM e DMARC passaram** | **caixa de entrada** |
| Hotmail | **SPF, DKIM e DMARC passaram** | **lixo eletrônico, SCL: 5** |

Os quatro envios saíram sem erro (2 códigos de login + 2 e-mails de campanha).

**O que isso significa.** A autenticação está correta — não há o que consertar em
SPF, DKIM ou DMARC. O `SCL: 5` do Outlook é classificação de **reputação**, não de
autenticação: domínio recém-criado, sem histórico de envio, cai em spam na
Microsoft mesmo com tudo verde. É esperado e se resolve com volume consistente ao
longo de semanas, que é exatamente o motivo do plano de ondas (50, 100, 250, 500,
1.000/dia) e do corte automático em 5% de falha.

**Consequência prática para a campanha**: uma fatia relevante da base usa
Hotmail/Outlook/Live. Antes de disparar as ondas grandes, vale considerar
[cadastrar o domínio no SNDS da Microsoft](https://sendersupport.olc.protection.outlook.com/snds/)
e no JMRP, e acompanhar o `rua` do DMARC (`suporte@jornadacomeuanjo.com`).

### Segunda rodada (22/10, depois dos modelos novos)

Quatro envios pelo staging, sem falha: código de login e anúncio para
`leonardovcs2022@gmail.com` e `anacacancelli@outlook.com`. **A pasta de cada um
ainda não foi conferida** — o Leo ia dizer. O que mudou desde a primeira rodada é
só o conteúdo (HTML completo, letra grande, rodapé sem CNPJ, link que já entra);
SPF, DKIM e DMARC são os mesmos, então uma mudança de pasta aqui é reputação ou
conteúdo, não autenticação.

### DNS do envio

`mail.jornadacomeuanjo.com` e `jornadacomeuanjo.com` estão habilitados no Email
Sending. Em `mail.` existem SPF, DKIM (`cf-bounce._domainkey`) e DMARC.

**O DMARC de `mail.` foi mudado de `p=reject` para `p=none`** nesta sessão: a
Cloudflare cria em `p=reject`, e domínio de envio novo com `p=reject` descarta
e-mail legítimo no primeiro desalinhamento, sem deixar rastro de diagnóstico.

**O SPF de `mail.` não existia** e foi criado. Na prática o SPF é checado no
envelope (`cf-bounce.mail.…`, que já tinha), mas o registro no domínio do `From`
evita veredito de "sem SPF" em verificador ingênuo.

---

## 6. Pendências que dependem do Leo

### Bloqueiam a campanha

1. **Códigos do UP1 e do UP2 na Payt.** Hoje o `payt_map` só tem a Jornada
   (`RVEEJ8`). Cada produto do funil precisa do `product.code` dele em
   `seed/catalogo.json` antes de qualquer importação ou disparo — senão o
   importador **interrompe** com a lista do que falta, de propósito.
   Os códigos saem do painel da Payt ou do primeiro postback de cada produto.

2. **CSV de vendas da Payt.** O importador está pronto mas nunca rodou.
   O fluxo combinado é: o Leo passa o arquivo, a sessão roda
   `npm run import:compradores -- vendas.csv --colunas`, **mostra o mapeamento de
   colunas e confirma antes de importar**.

### Segurança

3. **Trocar a `PAYT_INTEGRATION_KEY`.** Ela apareceu em claro numa sessão de
   trabalho (veio dentro do payload do postback, antes do mascaramento existir).
   Trocar é barato: mudar na Payt e rodar
   `npx wrangler secret put PAYT_INTEGRATION_KEY --env staging`. Nenhum arquivo
   depende dela.

### DNS, no painel (o token não tem permissão de DNS)

4. **Tirar o `rua=mailto:suporte@…` do `_dmarc.mail.jornadacomeuanjo.com`**,
   deixando `v=DMARC1; p=none;`. Pedido em 22/10 e **não feito**: o token OAuth do
   wrangler tem `zone (read)`, não escreve registro de DNS.

5. **Ativar o DMARC Management** (painel → domínio → Email → DMARC Management).
   Ele **só funciona em domínio apex**: cobre `jornadacomeuanjo.com`, não
   `mail.`. Ao achar o `_dmarc` que já existe, ele **acrescenta** um `rua` da
   Cloudflare e **não mexe na política** — o `p=reject` do apex continua. Depois
   de ativar, copiar esse mesmo endereço de `rua` para o `_dmarc.mail` à mão, que
   é como o subdomínio de envio entra no relatório.

6. **Teste de resposta ao suporte** ainda não foi feito: responder um dos e-mails
   recebidos e confirmar que chega no Gmail pelo Email Routing.

### Pipeline de conteúdo (pedir, não editar)

7. **`conteudo/emails/anuncio-app.md` está desatualizado** em dois pontos, e é de
   outra sessão (CLAUDE.md §3):
   - o bloco "Para entrar é simples" ainda descreve os três passos com código de
     6 números, mas o link do e-mail **já entra** — o texto contradiz o que o
     botão faz;
   - o rodapé ainda tem o `<small>` com razão social e CNPJ. O app **descarta
     esse bloco na leitura** (`emails/anuncio.ts`), então o e-mail sai certo, mas
     o arquivo continua dizendo o contrário do §14.

   O cabeçalho do arquivo também descreve `{{link_acesso}}` como
   `/entrar?e={email}`; hoje é `/acesso?t={token}`.

8. **Identidade visual.** Ícones em `public/icons/` são placeholder gerados por
   script (fundo azul com cruz dourada).

### Limitação de ferramenta

9. **A credencial da Cloudflare desta máquina não escreve DNS.** O wrangler está
   logado por OAuth (`C:\Users\lenzi\AppData\Roaming\xdg.config\.wrangler`), com
   workers, d1, pages, `email_routing` e `email_sending` em escrita, mas `zone`
   só em leitura — nenhum escopo de `dns_records`. Qualquer mudança de DNS é no
   painel, ou com um API token criado à parte com "Zone → DNS → Edit".

---

## 7. Armadilhas descobertas (custaram tempo)

**`NULL` não conflita com `NULL` no SQLite.** A `UNIQUE (user_id, product_id,
transaction_id)` **não** protege concessões manuais, que têm `transaction_id`
nulo: o `ON CONFLICT` nunca dispara e cada chamada cria linha nova. Por isso
`concederEntitlement` tem dois caminhos — o normal e um com `WHERE NOT EXISTS`.

**O `@cloudflare/vitest-plugin` não isola storage entre testes.** O
`vitest-pool-workers` antigo isolava e a opção `isolatedStorage` não existe mais.
Cada arquivo de teste limpa o banco num `beforeEach` (`test/ajuda.ts`). **Tabela
nova precisa entrar na lista `TABELAS`** — quando `campaign_sends` ficou de fora,
o `DELETE FROM users` passou a falhar com violação de FK, com sintoma confuso.

**`--env` no `wrangler deploy` é ignorado.** O ambiente é escolhido no build, por
`CLOUDFLARE_ENV`. Mas `wrangler d1 execute` e `migrations apply` **precisam** do
`--env staging`, senão leem o bloco top-level e não acham o banco.

**A Payt manda data em horário de Brasília, sem fuso.** `"2026-10-21 19:06:20.000000"`.
Guardar direto quebraria o `assinaturaValida`, que compara ISO por string — `' '`
ordena antes de `'T'`. `paytParaIso` normaliza na borda; data sem hora vira o
**fim** do dia, senão quem cancela perde o último dia pago.

**O `product.sku` da Payt é gerado por ela**, não é o nosso slug. O
`product_payt_map` pelo `product.code` é o caminho normal, não o fallback.

**O dedupe impede reenvio.** Evento que falhou não pode ser retomado pela origem:
o postback idêntico responde `duplicado: true`. Daí existir o reprocesso.

**Lição renomeada bate na `UNIQUE (program_id, day)`.** O `ON CONFLICT (id)` não
pega, porque o id mudou. O seed apaga lição que sumiu do conteúdo — restrito aos
programas que ele declara e **nunca** uma que algum usuário já concluiu.

**`spawnSync` com `npx.cmd` quebra no Windows.** Node bloqueia `.cmd` sem shell.
Os scripts chamam `node_modules/wrangler/bin/wrangler.js` pelo `process.execPath`.

**Prefixo de R2 não é pasta.** `jornada/` não casa com `jornada-cura/`. O upload
lista um prefixo por produto.

**Comando multi-statement no `wrangler d1 execute` nem sempre aplica.** Um
`DELETE` em cascata com vários `;` passou sem efeito e sem erro claro. Em operação
destrutiva, um comando por vez e conferir a contagem.

**`events.name` é um espaço compartilhado.** O log de envio usa `email_enviado` e
`email_falhou`, e um evento de conta chamado `email_trocado` entrou nesse mesmo
prefixo: toda consulta `name LIKE 'email_%'` passou a pegar um evento que não é
envio. Evento de conta leva prefixo `conta_` (`conta_excluida`,
`conta_email_trocado`). Quem achou isso foi um teste que lia o último `email_%`.

**Link de e-mail de uso único e leitor de links não se dão bem.** Outlook e Gmail
abrem links de e-mail para checagem, e isso pode consumir um token de uso único
antes da pessoa. Por isso a reivindicação é um `UPDATE ... WHERE used_at IS NULL`
conferido pelo número de linhas, e por isso o caminho de "já usado" cai na tela de
login com o e-mail preenchido em vez de numa página de erro. **Se aparecer relato
de "o link não funcionou na primeira vez", é aqui.**

**O DMARC Management da Cloudflare só vale para domínio apex.** Não dá para ativar
em `mail.jornadacomeuanjo.com`; o que dá é copiar o `rua` dele para o
`_dmarc.mail` à mão. Ativar no apex **não** muda a política que já está lá — ele
só acrescenta um `rua`.

**O e-mail de teste de compra era aleatório** e podia ser de uma pessoa real.
Virou regra no CLAUDE.md (§16): sempre endereço próprio. A limpeza exigiu apagar
o usuário de todas as tabelas e mascarar o payload.

---

## 8. Comandos que a próxima sessão vai querer

```bash
npm run typecheck && npm test        # antes de dar qualquer fase por concluída
npm run dev                          # Vite + Worker, D1 e R2 locais

npm run db:migrate:staging           # aplica migrations
npm run seed:staging                 # gera e aplica o seed (idempotente)
npm run deploy:staging               # build com CLOUDFLARE_ENV + wrangler deploy

npm run payt:last:staging            # últimos 5 postbacks, com o JSON
npm run payt:reprocess:staging X9P8DY5
npm run grant:staging <email> <produto>
npm run campanha:anuncio -- --env staging --limite 1 --teste-para <email> --dry-run
```

As credenciais da Cloudflare saem de `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID` no ambiente; a `ADMIN_API_KEY` sai do `.dev.vars`.
