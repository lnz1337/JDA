# Estado do projeto — 28/10/2026

Retrato para uma sessão nova continuar daqui. A spec é o [CLAUDE.md](../CLAUDE.md);
este arquivo registra o que **não** cabe lá: o que já rodou, o que está só em
staging, o que depende do Leo e as armadilhas que custaram caro.

`npm run typecheck && npm test` limpo, **421 testes** em 29 arquivos.

## Os dois ambientes

| | staging | produção |
|---|---|---|
| Domínio | `teste.jornadacomeuanjo.com` | `jornadacomeuanjo.com` + `www.` |
| Também responde | `jda-pwa-staging.leonardovcs2022.workers.dev` | — |
| Worker | `jda-pwa-staging` | `jda-pwa` |
| D1 | `jda-pwa-staging` (`53e3ee12-…`) | `jda-pwa-prod` (`eddb43c3-75ea-43f3-a8cf-4371a833b573`) |
| R2 | `jda-pwa-media-staging` | `jda-pwa-media` (34 áudios, 145 MB) |
| Banco | 3 usuários de teste, 8 postbacks, 9 tokens, 3 matrículas, **1 assinatura de push** (iPhone do Leo, serviço da Apple) | seed de 27/10 (10 produtos, 6 programas, 41 lições, 3 `payt_map`, 3 `payt_sku`); **1.422 usuários**: a base importada em 27/10 (1.421) e o Leo, com a Jornada concedida à mão |
| Indexável | não (`Disallow: /` + `noindex`) | sim, menos `/entrar`, `/acesso` e `/parar` |

Produção subiu em 23/10 e foi **atualizada em 27/10 com as fases 5, 6 e 8**, no
mesmo código do staging. **A base foi importada em 27/10** (1.421 clientes) e o postback está ligado desde as 14:58 do mesmo dia: compra nova já libera acesso. Falta a campanha avisar a base. A raiz serve a tela de Início.

---

## Lançamento para a base (começou em 27/10)

Em etapas, com pausa para o Leo em cada uma. Produção liberada só para o que o
roteiro descreve.

| Etapa | Estado |
|---|---|
| 1. Catálogo | **feita**: UP1 `oracao-sao-miguel` (`LPG38N`, R$ 197) e UP2 `jornada-cura-padre-pio` (`RAO7YD`, R$ 97) com checkout normal da Payt e no `payt_map` ao lado do `RVEEJ8`. O checkout sai **preenchido com `email` e `phone`** da conta (telefone só se houver; sem nome, o checkout não pede) |
| 2. Chave de administração | **feita**: `ADMIN_API_KEY` de produção gerada de novo pela receita do §15, no Git Bash; cópia local como `ADMIN_API_KEY_PRODUCTION` no `.dev.vars`. Os VAPID de produção **tinham BOM nos três valores** e passam pela leitura (ver "Secrets") |
| 3. Publicar produção | **feita**: migration `0006`, seed, os 34 áudios e deploy. Conta do Leo criada com a Jornada manual e e-mail de boas-vindas com link de acesso enviado. **Testada pelo Leo no iPhone em 27/10**: entrou pelo link, dia 1 com áudio, lembrete (push de confirmação chegou) e Loja até o checkout. O banco registrou `lesson_started`, `lesson_completed`, `push_ativado`, `push_enviado`, `store_viewed`, `product_viewed` e `checkout_clicked` |
| 4. Postback de produção | **feita em 27/10**: postback PayT V1 com todos os eventos cadastrado pelo Leo, `PAYT_INTEGRATION_KEY` de produção gravada. O teste da Payt (`PAYTS2`, `test: true`, `paid/paid`) chegou às 17:58 UTC, foi gravado com a chave mascarada (`"***"`) e **parou no passo 3 do §7**: sem erro, sem revisão, nenhum usuário, entitlement ou e-mail criado |
| 5. Importação da base (.xlsx) | **feita em 27/10**: 1.421 usuários e 1.904 entitlements em produção, conferidos no banco contra o dry-run. Os dois relatórios foram para a Lixeira do Windows. Detalhes: O importador lê o `.xlsx` direto e liga o produto pelo **sku** (o relatório não traz o `product.code`). Dry-run em produção com o relatório de 27/10 até 09:20: ver "Importação da base". ver "Importação da base" |
| 6. Primeira onda | **em andamento (28/10)**. Envio de teste do modelo completo (27/10) e do **modelo curto** (28/10, `--modelo curto`) só para o Leo. **Esperando o Leo** dizer em que aba do Gmail o curto caiu e qual modelo vai na onda de 50 |

**O que estava na raiz antes:** uma página estacionada da Hostinger
(`A jornadacomeuanjo.com → 2.57.91.91`, proxied) e um `CNAME www → raiz`. Os dois
foram **apagados** para o Custom Domain poder assumir — Custom Domain recusa host
com registro A/CNAME (`code: 100117`). Nada de e-mail foi tocado: MX, SPF, DKIM e
DMARC continuam onde estavam.

### Importação da base

**Ordem combinada com o Leo (27/10), para ninguém ficar de fora:** o postback de
produção entrou no ar às **17:58 UTC de 27/10** (14:58 em Brasília). O relatório
de 27/10 vai só até 09:20, então as vendas entre um e outro não estariam nem no
relatório nem no postback. Por isso o primeiro relatório serviu só para o
dry-run, e o Leo exporta um **novo**, cobrindo até depois das 14:58, que é o
importado. A importação é idempotente: quem estiver nos dois não duplica.

**O relatório `.xlsx` da Payt** (planilha `report`, 46 colunas) não tem o
`product.code`. O produto sai da coluna **Sku**, que vem como
`<prefixo>-<sku da Payt>`; o pedaço depois do hífen é o mesmo sku do postback.
Por isso o catálogo ganhou o `payt_sku` (migration `0007`, tabela
`product_payt_sku`), usado pelo importador **e** pelo postback — sku primeiro,
code depois:

```
853b4781f48478 -> jornada-meu-anjo        (R$ 97)
c58a626d8e337  -> oracao-sao-miguel       (UP1, "Oração Oculta de São Miguel Arcanjo", R$ 197)
3d11bdf6943ce8 -> jornada-cura-padre-pio  (UP2, R$ 97 e o downsell de R$ 37, mesmo pacote)
```

O "60 Receitas - Saladas No Pote" (2 linhas, ambas reembolso) fica de fora.
Colunas usadas: Email, Cliente, Telefone, **Código** (transação), Sku, Produto,
**Status Pagamento** e **Data da venda** (decisão do Leo; a alternativa era
"Data Aprovação do Pagamento").

**Dry-run de 27/10 em produção** (relatório até 09:20, 1.922 linhas):

| | |
|---|---|
| Vendas por status | 1.892 aprovadas (entram), 19 reembolsadas, 11 chargebacks |
| Sem e-mail válido | 0 |
| Produto sem mapeamento | nenhum |
| **Clientes únicos** | **1.410** (todos novos em produção) |
| Por provedor | gmail 1.140, outlook 127, yahoo 59, outros 40, uol 25, icloud 10, terra 9 |
| Entitlements | jornada-meu-anjo 1.505, oracao-sao-miguel 232, jornada-cura-padre-pio 155 (1.892) |
| Período | 29/07 a 27/10/2026 |

Todo cliente tem a Jornada; 64 compraram a Jornada mais de uma vez (cada compra
é um entitlement, sem efeito no acesso).

**Dry-run do relatório novo** (`vendas_27_10_2026 - novo.xlsx`, exportado às
20:23 de 27/10, 1.934 linhas):

| | |
|---|---|
| Vendas por status | 1.904 aprovadas (entram), 19 reembolsadas, 11 chargebacks |
| Sem e-mail válido | 0 |
| Produto sem mapeamento | nenhum |
| **Clientes únicos** | **1.421** (todos novos em produção) |
| Por provedor | gmail 1.147, outlook 129, yahoo 60, outros 41, uol 25, icloud 10, terra 9 |
| Entitlements | jornada-meu-anjo 1.516, oracao-sao-miguel 233, jornada-cura-padre-pio 155 (1.904) |
| Última venda | 27/10 às 14:37 em Brasília (`787NXNG`) |

Contra o primeiro: +12 vendas aprovadas, +11 clientes, +11 Jornadas e +1 UP1.
**A cobertura fecha**: a última venda do relatório é das 14:37, o postback entrou
às 14:58, e até a exportação nenhum postback pago real chegou em produção — então
não houve venda nem antes do postback fora do relatório, nem depois dele fora do
postback.

**Importado em produção em 27/10, com o ok do Leo.** A conferência do script,
antes → depois, bateu linha a linha com o dry-run:

```
ok   usuários: esperado +1421, banco +1421
ok   entitlements jornada-meu-anjo: esperado +1516, banco +1516
ok   entitlements oracao-sao-miguel: esperado +233, banco +233
ok   entitlements jornada-cura-padre-pio: esperado +155, banco +155
```

Conferido também por fora do script: 1.422 usuários (todos com nome; só o do Leo
sem telefone), todos os entitlements `payt` ativos, `granted_at` de 29/07 a
27/10 (a data da venda, não a da importação) e **nenhum usuário sem a Jornada**.
O arquivo SQL temporário não ficou na pasta. Um dry-run rodado logo depois dá
0 usuários e 0 entitlements novos: a importação é idempotente de verdade.

Os dois relatórios de 27/10 foram para a **Lixeira do Windows**, não apagados de
vez — esvaziar a lixeira fica com o Leo. Os de 22/10 (`vendas_22_10_2026.csv` e
`.xlsx`), de uma sessão anterior, continuam em Downloads até o Leo decidir.

**Como a importação grava:** um arquivo SQL só, na pasta temporária do sistema
e apagado no fim (tem dado de cliente). Usuário existente só ganha telefone e
nome que estejam vazios; concessão que já existe **não muda** — se um
reembolso chegou pelo postback depois da exportação, o relatório velho não
devolve o acesso. Depois de aplicar, o script conta usuários e entitlements por
produto no banco e compara com o plano.

### Primeiras vendas pelo postback de produção (27 a 28/10)

Do ar (27/10, 14:58) até 28/10, 13:13: **9 vendas pagas reais**. As 8 compras
da Jornada viraram acesso, com usuário novo e e-mail de boas-vindas, sem falha.
**O upsell `KY5W52D` (UP1, R$ 197, do cliente da `NPXB7O3`) foi recusado**:
o postback do upsell de um clique chega com `link` só com `title` e
`sources`, sem `url` e sem `query_params`, e no Zod 4 `z.unknown()` dentro
de objeto é obrigatório — o pedido pago inteiro caiu por um campo de relatório.
O mesmo erro pegou 4 eventos que não concediam nada (Pix vencido, cartão
recusado).

O que foi feito em 28/10, nesta ordem e com o ok do Leo:

1. **Correção publicada** (`5204ea3`) com o `--modelo curto` e a migration
   `0008`. Era urgente: todo UP1/UP2 do funil cairia no mesmo erro.
2. **Reprocesso em produção** liberado só por transação, com
   `--confirmo-revisado`, e registrado em `events` (`payt_reprocessado`).
   O `KY5W52D` foi reprocessado: UP1 ativo com a `transaction_id` real e
   e-mail de "conteúdo liberado" enviado. **Push não saiu porque o cliente não
   tem lembrete ligado** (nenhuma assinatura de push), não por falha.
3. `expired` e `refused` passaram a **só registrar**. A fila de revisão foi
   zerada: as 15 linhas que estavam lá (12 `expired`, 1 cancelamento por Pix
   vencido, 2 cartões recusados) estão descritas no evento `payt_fila_limpa`.
4. **Schema tolerante**: só o que decide o acesso é obrigatório (§7).
5. **Alerta por e-mail** ao suporte quando uma venda paga falha no
   processamento, sem dado pessoal (`services/alerta-postback.ts`).

Nenhum postback chegou entre as publicações de 28/10 e o envio de teste do
modelo curto, então a correção ainda não foi vista com um upsell real.

---

## O que está aberto

Seis itens: o primeiro se resolveu sozinho e fica aqui só como registro, os
quatro do meio continuam esperando e o último é opcional.

### 1. Segundo login no iPhone: não se reproduziu (26/10)

**Resolvido por observação, sem código.** No teste de 26/10 o app aberto pelo
ícone manteve a sessão por várias aberturas: o `GET /api/me` responde 200 sem
nenhum `/api/auth/codigo` antes dele. O único login por código do dia veio depois
de um `POST /api/auth/sair` que o Leo mesmo pediu.

É **um aparelho, num dia**, não uma prova geral — se aparecer em outro iPhone, a
ordem combinada continua valendo:

- **A) Entrega por CacheStorage**: logado no Safari, o app grava um token de uso
  único numa entrada do Cache; o app aberto pelo ícone lê, troca por sessão e
  apaga a entrada. O token segue as regras do `/acesso` (hash no banco, preso ao
  usuário, 7 dias, reivindicação atômica).
- **B) O mesmo token no `start_url`**, com manifest dinâmico servido **só** para o
  Safari do iPhone — manifest que varia quebra a WebAPK do Android, então o
  Android continua com o estático.

Fica o que funcionar no aparelho de verdade. Se nenhum funcionar, fica o login por
código, que já funciona. **Nada disso foi construído**, e não é para construir
enquanto não houver um aparelho em que o problema aconteça.

### 2. Os testes da fase 8: iPhone **feito**, Android pendente

**iPhone, 26/10: funciona de ponta a ponta.** A assinatura gravou
(`web.push.apple.com`), o push de confirmação chegou no aparelho, e o banco
registra o envio: `push_subscriptions.last_success_at` três segundos depois do
`created_at`, e um `push_enviado` com `{"servico":"apple","tipo":"confirmacao"}`.
No Worker:

```
13:00:13  POST /api/push/assinatura   200
13:00:15  POST /api/push/confirmacao  200
```

Levou um bug pelo caminho: um **BOM dentro do `VAPID_PUBLIC_KEY`** derrubava o
`subscribe` no Safari. Está nas armadilhas, e é a que mais vale ler.

**Falta o Android**, que é a maioria do público — nada do fluxo foi exercitado em
Chrome de verdade (prompt nativo de instalação, `beforeinstallprompt`, serviço de
push do Google). O roteiro abaixo continua valendo inteiro para ele.

**Falta também**, no iPhone: tocar na notificação **com o app fechado** e conferir
que ela abre a oração do dia (passo 4 do roteiro do iPhone), e o lembrete diário
chegando no horário pelo cron — até agora só o push de confirmação foi exercitado.
O `push_envios` continua vazio.

**Antes de testar, feche e reabra o app**: o service worker guarda a versão
anterior, e abrir por cima mostra o app de antes (ver as armadilhas).

Android, que é a maioria do público:

1. Abrir `teste.jornadacomeuanjo.com` no Chrome e entrar.
2. Deve aparecer "Coloque o Meu Anjo na tela do seu celular" com o botão
   **Colocar na tela inicial** (prompt nativo). Instalar.
3. Abrir pelo ícone → "Quer um lembrete para rezar todo dia?" → **Quero o
   lembrete** → permitir.
4. Escolher um horário → **tem que chegar um push na hora**: "Pronto! Hoje às 18h
   eu te lembro da oração do dia."
5. Tocar na notificação → o app abre.
6. Na Home deve aparecer "Lembrete às 18h · mudar".

iPhone:

1. Safari → entrar → devem aparecer os 4 passos com os ícones desenhados.
   **Conferir se o Compartilhar está na barra ou dentro do `⋯`** no iOS dele, e se
   o texto acerta.
2. Instalar, abrir pelo ícone (aqui entra o item 1 desta lista).
3. Lembrete → permitir → horário → **o push de confirmação precisa chegar**.
4. Com o app fechado, a notificação tem que abrir a oração do dia.

Para disparar um push a qualquer momento, sem esperar a hora:

```bash
npm run push:teste -- --email leonardovcs2022@gmail.com --env staging
```

### 3. A Loja tem os dados comerciais (27/10)

A fase 6 **passou no teste de ponta a ponta em 26/10**, com compra e reembolso
de verdade (transação `82JJPJX`): o funil registrou
`store_viewed → product_viewed → checkout_clicked → purchase_from_app`, o app
percebeu a liberação sozinho na volta, o push e o e-mail de "já está no seu
app" chegaram, e o reembolso revogou o acesso.

Os dados comerciais chegaram em 27/10 e estão no `seed/catalogo.json` (ver
"Lançamento para a base"). **O seed de staging não rodou de novo**: lá o
`oracao-sao-miguel` continua com o checkout de teste do "60 Receitas", à mão.
Rodar `seed:staging` troca pelo checkout real — e uma compra de teste no
staging passaria a cobrar R$ 197 de verdade.

### 4. Produção alcançou o staging (27/10)

As fases 5, 6 e 8 foram publicadas em produção em 27/10, a pedido do Leo, com
migration, seed (que trouxe os `summary` dos 19 dias) e os áudios.

### 5. Em que pasta caíram os e-mails de 22 e 23/10

Seis envios saíram sem falha, mas **ninguém conferiu a caixa**. A última rodada é
o teste da hipótese de que o Outlook pesava o domínio do link (`workers.dev` →
`teste.jornadacomeuanjo.com`), com o mesmo conteúdo de antes. Sem essa resposta
não dá para saber se a mudança ajudou. Detalhe em "Resultado do teste de e-mail".

### 6. Opcional, só quando o Leo pedir: Política, Termos e registro de acesso

**Decisão do Leo em 26/10: o app lança sem as duas coisas abaixo, e elas não
bloqueiam mais a campanha.** Ficam como pendência opcional — não é para começar
sem ele pedir.

- **Páginas `/privacidade` e `/termos`.** O texto já está escrito, em
  `conteudo/legal/privacidade.md` e `conteudo/legal/termos.md` (do pipeline de
  conteúdo). Falta servir no app.
- **Registro de acesso**: IP, data e hora em toda entrada, apagados depois de 6
  meses. Hoje o IP só entra em `login_codes.ip`, no pedido de código.

O que essa decisão muda na prática, conferido em 26/10:

- **Nenhum link quebra.** Nada no app aponta para `/privacidade` ou `/termos`. O
  rodapé do `conteudo/emails/anuncio-app.md` tem o link para a Política, mas ele
  é **descartado na leitura** (`semRodapeAntigo` em `emails/anuncio.ts`) e não
  sai no e-mail.
- **Não há página nenhuma com a identificação da empresa.** O rodapé dos e-mails
  não leva razão social nem CNPJ de propósito (§14), porque esse dado ia morar na
  Política. Sem a página, quem quiser saber quem é o controlador dos dados não
  acha em lugar nenhum do app nem do e-mail — só pelo `Reply-To` do suporte.
- **A §14 do CLAUDE.md continua listando a Política como requisito.** A decisão
  está registrada em "Decisões que não estão no CLAUDE.md"; a spec não foi
  mexida.

---

## 1. Fases

| Fase | Situação |
|---|---|
| 1 — Scaffold | **concluída** |
| 2 — Banco | **concluída** |
| 3 — Postback Payt | **concluída e validada com a Payt de verdade** |
| 4 — Auth | **concluída**, com e-mail entregando. Revisada 22/10 para o público 55+: link de acesso direto (com tela de confirmação, para pré-visualizador de link não gastar o token), sessão de 1 ano, código em ação sensível, tela de código mais fácil |
| 5 — Jornada | **concluída em 23/10**: Home com o cartão do dia, lista de dias com estado, player com Range/Media Session/retomada, conclusão e os eventos do funil |
| 6 — Loja | **concluída e testada com compra real em 26/10** (staging): barra de abas, lista, página do produto, volta da compra, aviso por push e e-mail, funil completo. Falta só os dados comerciais do Leo para valer em produção |
| 8 — Push | **concluída em 23/10** (fora de ordem, a pedido): instalação na tela inicial, lembrete diário e escolha do horário. **Testada no iPhone em 26/10**, com três correções: etapa da falha registrada, ordem do toque no Safari e o BOM do segredo VAPID. Android ainda não |
| 7, 9 a 12 | não começaram |

### Fora do escopo das fases, já construído

A **campanha de anúncio do app** (importador da base, disparo em ondas, opt-out,
exportação de quem não tem e-mail) foi construída adiantada, a pedido. Está
pronta e testada, mas **nunca foi disparada para ninguém além dos dois e-mails
de teste**. O texto é do pipeline de conteúdo (`conteudo/emails/anuncio-app.md`).

### O estado do usuário de teste (staging)

O `leonardovcs2022@gmail.com` tem **um produto ativo**: `jornada-meu-anjo`.

Os outros dois passaram por aqui e foram revogados, o que deixa o banco bom
para testar reembolso de novo:

| Produto | Fonte | O que aconteceu |
|---|---|---|
| `oracao-sao-miguel` | `payt` (tx `82JJPJX`) | comprado e reembolsado em 26/10, no teste da fase 6 |
| `manual-purificacao` | `manual` | concedido à mão em 23/10 para conferir produto avulso; **revogado em 26/10** |

O `manual-purificacao` foi revogado a pedido do Leo porque confundia: como
concessão manual não tem `transaction_id`, ela sobreviveu ao reembolso do
pacote que a contém, e a Home seguia mostrando "também liberado para você".
Está nas armadilhas. Com ele fora, `/api/programas` devolve só a jornada e
`/api/licoes/manual-purificacao-l01` responde 403.

Sobrou uma **matrícula órfã** em `manual-purificacao`: matrícula e progresso
não são revogados junto com o acesso (nem devem ser — quem recompra não perde
o que já rezou). Ela não aparece em lugar nenhum enquanto o acesso não voltar.
A **matrícula começou em 23/10** e o progresso está **zerado**. Como o dia libera
pelo calendário, o "dia de hoje" anda sozinho: em 26/10 ele é o **dia 4**, com 1 a
3 como "liberado" e 5 em diante bloqueados. Se o teste precisar começar do dia 1,
é mover o `started_at`:

```bash
# volta a matrícula para hoje, para testar o primeiro dia de novo
npx wrangler d1 execute DB --env staging --remote \
  --command "UPDATE enrollments SET started_at = '<agora em ISO>' WHERE user_id = '2407c08c9845df0fca7d856d322626e3'"
```

Os eventos do funil em `events` (`lesson_started`, `audio_completed`,
`lesson_completed`, um de cada) são resíduo do teste de 23/10 e **não têm progresso
correspondente**, porque o progresso foi zerado depois. Não é inconsistência de
código.

**O iPhone do Leo está assinado** desde 26/10 (serviço da Apple) e recebeu o push
de confirmação. O **lembrete diário** pelo cron ainda não foi exercitado
(`push_envios` vazio), nem nenhum aparelho Android — ver "O que está aberto".

### O que ficou de fora de propósito

- **Loja, assinatura, mural, ofertas e admin** (fases 6, 7, 9, 10 e 11): o client
  tem Início, login, Home com o cartão do dia, lista de dias, player e as telas de
  instalar/lembrete/horário. Não há onde comprar nem onde publicar intenção.
- **Bottom nav com 4 abas** (§4): só existe a Jornada, então não há abas ainda.
- **Perfil**: por isso a troca de horário é a linha "Lembrete às 7h · mudar" na
  Home, e a exclusão de conta é pelo suporte (`npm run conta:excluir`).
- **Login por WhatsApp** para `fake_email` (§8): continua fase 2, como a spec diz.

---

## 2. Decisões que não estão no CLAUDE.md

**O app lança sem Política, Termos e registro de acesso** (decisão do Leo,
26/10). A §14 pede a página de Política e Termos com o CNPJ; o Leo decidiu
lançar e fazer a campanha sem ela, e deixar as páginas e o registro de IP em
toda entrada como pendência opcional. Ver "O que está aberto", item 6.

**Rotas administrativas são interinas.** `/api/payt/reprocess`,
`/api/campanha/enviar` e `/api/admin/conceder` existem porque os scripts de
operação precisam do banco e do envio de e-mail, que só o Worker tem. Elas usam
`ADMIN_API_KEY` no header `x-admin-key`. Na fase 11 o admin entra atrás do
Cloudflare Access (§13) e **estas rotas saem**.

**O reprocesso recusa rodar em produção.** Reprocessar sem revisão humana pode
conceder acesso a partir de um payload que foi recusado por motivo legítimo.

**`vitest` roda em dois projetos.** `node` (validação do gerador de seed, que usa
`node:fs`) e `workers` (o resto). O validador não roda no runtime do Workers.

**O roteador é nosso, não é biblioteca.** `client/lib/rota.ts` resolve por
`pathname` em umas 40 linhas (`/`, `/entrar`, `/programa/:id`, `/licao/:id`,
`/instalar`, `/lembrete`), com `pushState` e um evento próprio. São poucas telas e
o app precisa abrir rápido em celular antigo. Se uma fase pedir rota aninhada ou
carregamento por rota, a troca fica contida nesse arquivo — o resto do app só usa
`useRota` e `irPara`.

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
ADMIN_API_KEY            # reprocesso, campanha, concessão manual, push de teste
CAMPAIGN_SIGNING_KEY     # assina o link de "parar de receber"
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
```

### Push: o que existe em cada ambiente (23/10)

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` estão nos **dois**
ambientes, com **pares diferentes**, gerados sem a privada passar pela tela. O
cron `*/5 * * * *` está declarado nos dois — environment do wrangler **não herda**
o bloco de cima do `wrangler.toml`.

**Trocar o par VAPID invalida todas as assinaturas já gravadas**: a chave pública
entra no `subscribe` do navegador, e o serviço de push recusa um envio assinado
por outra. Se um dia for preciso trocar, é com a tabela `push_subscriptions`
limpa e todo mundo assinando de novo.

A chave pública de staging, que não é segredo e ajuda a conferir no aparelho:
`BPxwmcCZ9XOsUJAqJncm8O0dUB9DQgDnJgXnoiWElJXaP4LeaTtEqSlZkj2G_XeCL9Pv03fLT4kUitcES84VXaY`.

### Staging — ainda faltam

```
RESEND_API_KEY           # só se MAIL_PROVIDER virar "resend"
```

### Produção — cadastrados

```
ADMIN_API_KEY            # REGERADA em 27/10; cópia local ADMIN_API_KEY_PRODUCTION no .dev.vars
CAMPAIGN_SIGNING_KEY     # 23/10, sem cópia (só o Worker precisa dela)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT   # par próprio de produção, 23/10
```

A `ADMIN_API_KEY` de 23/10 não tinha cópia e foi **substituída** em 27/10 pela
receita do §15, no Git Bash: o mesmo comando grava o wrangler e acrescenta
`ADMIN_API_KEY_PRODUCTION` ao `.dev.vars`, sem a chave passar pela tela. Os
scripts escolhem a cópia pelo `--env`; a chave de staging em produção é 401.

**Os três VAPID de produção têm BOM gravado** — o pipe do PowerShell de 23/10,
o mesmo que sujou o staging. `GET /api/admin/vapid` em 27/10: pública 88 → 87,
privada 44 → 43, assunto 36 → 35, todos com `tinha_bom: true`; depois da
leitura, ponto P-256 válido, privada de 32 bytes, assunto válido e **o par
confere** (assina com uma, verifica com a outra). Funciona como está. Regravar
sem BOM é opcional e **não** invalida assinaturas (o valor lido é o mesmo); não
foi feito porque ninguém pediu.

### Produção — gravado em 27/10 pelo Leo

```
PAYT_INTEGRATION_KEY     # postback PayT V1 de produção, todos os eventos
```

---

## 4. Staging: o que existe lá e não vai para produção

### Usuários de teste (3)

| E-mail | Acesso | Como |
|---|---|---|
| `leonardovcs2022@gmail.com` | `jornada-meu-anjo` + `manual-purificacao` | `grant:staging`, `source = 'manual'` |
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

Existe uma quarta linha em `users`, **já anonimizada**: foi uma conta descartável
(`excluir-teste@exemplo.invalido`) criada em 23/10 só para exercitar o
`conta:excluir` de ponta a ponta. Ela não conta como usuário de teste — tem
`deleted_at` preenchido e nada mais.

### `product_payt_map` no staging

```
RVEEJ8 -> jornada-meu-anjo     # REAL, vem do seed, vale em produção
LJ7KEP -> oracao-sao-miguel    # SÓ STAGING, à mão, nunca em produção
```

O `LJ7KEP` apontava para a jornada e **passou a apontar para o
`oracao-sao-miguel`** em 26/10, para o teste de compra da fase 6 exercitar um
bundle de verdade (três partes, dois avisos obrigatórios).

Junto com ele, à mão e **só no staging**:

```sql
UPDATE products SET checkout_url = 'https://payt.site/wGCBqre'
 WHERE id = 'oracao-sao-miguel';   -- o checkout do "60 Receitas"
```

**Isso não sobrevive a um `npm run seed:staging`**: `checkout_url` vem do
`seed/catalogo.json`, onde ainda é nulo, e o seed faz UPSERT em `products`. O
`product_payt_map` sobrevive, porque o seed nunca apaga o que não declara.
Depois de reaplicar o seed, é só rodar o `UPDATE` de novo.

`LJ7KEP` é o código do **"60 Receitas - Saladas No Pote"**, um produto que não é
nosso, usado só para exercitar o fluxo de compra. Em produção, mapear o código de
um produto para outro daria acesso errado a quem comprou. Por isso o seed só faz
`UPSERT` em `product_payt_map` e **nunca apaga** o que não está declarado — uma
limpeza derrubaria esse mapeamento a cada rodada.

### Tokens de acesso em staging

A tabela `access_links` tem 8 tokens: dois dos e-mails de anúncio de teste (um por
destinatário) e o resto gerado à mão nas sessões de teste, para entrar no app sem
esperar e-mail. São de uso único: se já foi clicado, o link cai na tela de login
com o e-mail preenchido — comportamento esperado, não defeito.

Para entrar como alguém em staging sem esperar e-mail, o caminho é inserir um
token (o hash é `sha256` do token em claro) e abrir `/acesso?t=<token>`.

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
e no JMRP, e acompanhar os relatórios no DMARC Management da Cloudflare (o `rua`
não vai mais para o suporte).

### Quarta rodada (23/10, já pelo `teste.jornadacomeuanjo.com`)

Código de login e anúncio para os dois endereços, **sem falha**, agora com os
links no subdomínio próprio em vez do `workers.dev`. É o teste da hipótese de que
o Outlook estava pesando o domínio do link: o conteúdo é o mesmo da rodada
anterior, só o domínio mudou. **Resultado ainda não conferido.**

Vale o aviso: domínio do link é **um** sinal entre vários. O peso maior continua
sendo reputação de domínio novo, que só sobe com volume constante ao longo de
semanas — por isso o plano de ondas e o `--provedores gmail`.

### Segunda e terceira rodadas (22/10)

Seis envios pelo staging, sem falha nenhuma: código de login e anúncio para
`leonardovcs2022@gmail.com` e `anacacancelli@outlook.com`, mais o reenvio do
anúncio para os dois com a tela de confirmação já no ar. **A pasta de cada um
ainda não foi conferida.** O que mudou desde a primeira rodada é só o conteúdo
(HTML completo, letra grande, rodapé sem CNPJ, link que já entra); SPF, DKIM e
DMARC são os mesmos, então mudança de pasta aqui é reputação ou conteúdo, não
autenticação.

Um dos tokens da segunda rodada apareceu como **usado** antes do reenvio. Pode
ter sido o Leo testando o link, ou um leitor de link do provedor — que é
exatamente o motivo de o GET ter deixado de consumir o token.

### DNS do envio

`mail.jornadacomeuanjo.com` e `jornadacomeuanjo.com` estão habilitados no Email
Sending. Em `mail.` existem SPF, DKIM (`cf-bounce._domainkey`) e DMARC.

**O DMARC de `mail.` é `p=none`**: a Cloudflare cria em `p=reject`, e domínio de
envio novo com `p=reject` descarta e-mail legítimo no primeiro desalinhamento, sem
deixar rastro de diagnóstico. O apex fica em `p=reject`, por decisão do Leo.

Como os dois registros estão hoje:

| Registro | Conteúdo |
|---|---|
| `_dmarc.jornadacomeuanjo.com` | `v=DMARC1; p=reject; rua=mailto:e11046c0725a4827b21a40ecd2139f43@dmarc-reports.cloudflare.net;` |
| `_dmarc.mail.jornadacomeuanjo.com` | `v=DMARC1; p=none; rua=mailto:e11046c0725a4827b21a40ecd2139f43@dmarc-reports.cloudflare.net;` |

O `rua` é o do **DMARC Management da Cloudflare**, ativado em 22/10 — caixa de
suporte recebendo XML de relatório só atrapalha o atendimento. O `p=reject` do
apex sobreviveu à ativação: o DMARC Management acrescenta o `rua` e não mexe na
política. Os dois domínios relatam para o mesmo endereço, então o envio do app
(`mail.`) e qualquer uso indevido do apex aparecem no mesmo lugar.

**O SPF de `mail.` não existia** e foi criado. Na prática o SPF é checado no
envelope (`cf-bounce.mail.…`, que já tinha), mas o registro no domínio do `From`
evita veredito de "sem SPF" em verificador ingênuo.

---

## 6. Pendências que dependem do Leo

### Bloqueiam a campanha

1. ~~Códigos do UP1 e do UP2 na Payt~~ — no `payt_map` desde 27/10
   (`LPG38N`, `RAO7YD`).

2. **Relatório de vendas da Payt.** O importador está pronto mas nunca rodou.
   **Em 27/10 ficou combinado que o arquivo vem em `.xlsx`** e o importador lê
   direto (etapa 5 do lançamento) — ainda não implementado.
   O fluxo combinado é: o Leo passa o arquivo, a sessão roda
   `npm run import:compradores -- vendas.csv --colunas`, **mostra o mapeamento de
   colunas e confirma antes de importar**.

   Desde 22/10 o importador também procura uma **coluna de data da venda** e a
   grava no `granted_at` do entitlement — é por ela que a campanha ordena as
   ondas. Se o CSV não trouxer data que dê para ler, ele avisa quantas linhas
   ficaram com a data da importação, e para essas a ordem não diz nada. Vale
   conferir no `--colunas` qual coluna ele escolheu antes de importar de verdade.

### Segurança

3. **Trocar a `PAYT_INTEGRATION_KEY`.** Ela apareceu em claro numa sessão de
   trabalho (veio dentro do payload do postback, antes do mascaramento existir).
   Trocar é barato: mudar na Payt e rodar
   `npx wrangler secret put PAYT_INTEGRATION_KEY --env staging`. Nenhum arquivo
   depende dela.

### E-mail

4. **Teste de resposta ao suporte** ainda não foi feito: responder um dos e-mails
   recebidos e confirmar que chega no Gmail pelo Email Routing.

### Pipeline de conteúdo (pedir, não editar)

5. **O rodapé do `anuncio-app.md` é descartado na leitura**
   (`emails/anuncio.ts`), porque quem monta o rodapé é o renderizador, igual nos
   três e-mails — senão o "parar de receber" sai duas vezes. Com isso, o
   `· jornadacomeuanjo.com · Política de Privacidade` que o pipeline pôs lá **não
   aparece no e-mail**. Se o Leo quiser esse link no rodapé, é uma linha no
   `motivo` em `montarAnuncio`.

6. **Identidade visual.** Ícones em `public/icons/` são placeholder gerados por
   script (fundo azul com cruz dourada).

### Limitação de ferramenta

7. **A credencial padrão desta máquina não escreve DNS.** O wrangler está logado
   por OAuth (`C:\Users\lenzi\AppData\Roaming\xdg.config\.wrangler`), com
   workers, d1, pages, `email_routing` e `email_sending` em escrita, mas `zone`
   só em leitura — nenhum escopo de `dns_records`. Para DNS é preciso um API
   token criado à parte com "Zone → DNS → Edit"; foi assim que o `_dmarc.mail`
   mudou em 22/10. **Esse token não está gravado em arquivo nenhum** (nem no
   `.dev.vars`): quem for mexer em DNS pede de novo ao Leo.

   Ids úteis da zona, que não são segredo: zone
   `ec2afa685c14f4f2b58d6fb87a52b4e3`, registro `_dmarc.mail`
   `2b5d717f04ef204667b97c61a7d5b326`, conta
   `5b1faf97555fc2afb38ea4fd2cdb642e`.

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

**Link de e-mail de uso único e leitor de links não se dão bem.** Outlook, Gmail e
WhatsApp abrem links de mensagem para checagem, e isso consome um token de uso
único antes da pessoa. A solução é o GET não consumir nada: ele só mostra uma tela
com um botão, e o token morre no POST do botão, que verificador de link não
dispara. Por isso a tela **não pode** se enviar sozinha por JavaScript — seria
imitável por pré-visualizador — e por isso ela é igual para token válido, vencido
e inventado, sem nem consultar o banco.

**Evento de "começou a ouvir" não pode nascer no clique do botão.** O
`lesson_started` saía do `onClick` do Tocar, e sumiu num teste que deu play pelo
elemento de áudio — que é exatamente o que acontece quando a pessoa toca pelos
controles da tela de bloqueio ou do fone. Ele passou para o evento `play` do
próprio `<audio>`, que pega todos os caminhos.

**Texto de conteúdo repetia o aviso obrigatório.** O `manual-purificacao` trazia o
aviso de saúde como citação na primeira linha do corpo, e ele aparecia duas vezes:
na faixa do topo (que a §14 exige) e no texto. O Worker tira o primeiro bloco
quando ele é exatamente o aviso.

**O service worker serve a versão antiga depois do deploy.** O shell do app está
no precache; publicar não troca o que já está no aparelho até o SW atualizar. No
teste do push isso custou uma investigação: o onboarding não aparecia porque o
navegador servia o bundle anterior. Ao conferir mudança de client em aparelho que
já abriu o app, **feche e reabra** (ou limpe o SW no navegador). Vale para o
celular do Leo também.

**Tabela nova = linha nova no `TABELAS` do `test/ajuda.ts`.** Aconteceu de novo
com `push_envios`: o `DELETE FROM users` passou a falhar com violação de FK, e o
sintoma (12 testes quebrados em arquivos sem relação) não aponta para a causa.

**Custom Domain não convive com registro A/CNAME no mesmo host.** O deploy sobe o
Worker, falha só na parte de domínio (`code: 100117`) e **não desfaz o que já
mudou** — fica meio aplicado. Apagar o registro antigo e rodar o deploy de novo
resolve. Vale para a raiz e para o `www`: o `www` era CNAME para a raiz e passou a
dar **522** no momento em que a raiz virou Custom Domain, porque o Worker não
atende por um host que não é dele.

**`ORDER BY 0` não é constante no SQLite: é índice de coluna.** A ordenação por
provedor monta um `CASE` e, quando não há provedor pedido, o termo precisa sair da
cláusula — emitir `0` dá "1st ORDER BY term out of range". O sintoma foi o disparo
inteiro respondendo 400, longe da linha do problema.

**O DMARC Management da Cloudflare só vale para domínio apex.** Não dá para ativar
em `mail.jornadacomeuanjo.com`; o que dá é copiar o `rua` dele para o
`_dmarc.mail` à mão. Ativar no apex **não** muda a política que já está lá — ele
só acrescenta um `rua`.

**`wrangler secret put` por pipe no PowerShell grava BOM dentro do segredo.** O
`VAPID_PUBLIC_KEY` do staging tinha um U+FEFF no começo — 88 caracteres em vez de
87 — e o `subscribe` do Safari morria com `InvalidCharacterError: The string
contains invalid characters`, mensagem que não aponta para segredo nenhum. O
`atob` do navegador é estrito; o `Buffer.from(..., 'base64')` do Node **ignora** o
BOM, então conferir a chave pelo Node não acusa nada — foi o que atrasou o
diagnóstico. Pior: como o padding sai do tamanho da string
(`padEnd(Math.ceil(len/4)*4, '=')`), com 88 a conta dá 88 e o `=` que falta não é
acrescentado, então **tirar só o caractere não bastaria** — a limpeza tem que vir
antes de medir. A normalização ficou no `vapidDe` (`services/push.ts`), único
ponto onde os três valores são lidos, porque o mesmo pipe gravou a chave privada e
o `VAPID_SUBJECT` — e assunto com BOM faria o `assuntoVapidValido` recusar o
`mailto:`. Nenhum segredo precisou ser trocado: o valor é o mesmo, só deixa de
chegar sujo. **Vale para produção**, cujo par VAPID foi gravado do mesmo jeito.
Quando for gravar segredo por pipe no Windows, confira o tamanho depois.

**`catch` mudo em fluxo que só roda no celular custa uma sessão inteira.** O
`ligarLembrete` tinha `catch { return 'erro' }`, e a tela dizia "não consegui
ligar o lembrete agora" — sem Mac não há inspetor para o Safari do iPhone, então
não havia como saber se parou na permissão, no service worker, na chave, no
`subscribe` ou na gravação. Quem resolveu foi marcar a etapa antes de cada passo e
gravar `push_erro_cliente` com a etapa e o erro no formato `nome: mensagem`; em
staging a tela mostra essa linha. O **`name` da exceção** é o que informa
(`InvalidCharacterError` apontou direto para o `atob`), e ele é lido sem
`instanceof Error`, porque em WebKit antigo `DOMException` não herda de `Error`.

**O `wrangler tail` mostra o que não aconteceu.** O diagnóstico saiu de ver
`GET /api/push/chave` com 200 e **nenhum** `POST /api/push/assinatura` depois: isso
já descartava sessão, chave e validação do Worker, e deixava a falha no aparelho.
Vale ouvir o tail antes de mexer em código quando o bug é de celular.

**Permissão concedida não quer dizer assinado, e a rota `/lembrete` confundia os
dois.** Ela mandava para o `PassoHorario` quando a permissão estava concedida, e
escolher a hora sem assinatura não liga nada — o `/api/push/confirmacao`
respondia `sem_assinatura` (404). Somava com duas outras: o `passoAtual` só
oferece o lembrete com a permissão em `default`, e o "Continuar" da tela de falha
chamava o mesmo `aoPular` do "Agora não", que dispensa o convite por sete dias
logo depois de a pessoa tentar. Três becos no mesmo caminho: quem falhava na
assinatura não tinha mais onde tocar.

**As UTMs voltam em `link.sources`, não em `link.query_params`.** O nome engana:
o `query_params` fica **vazio** mesmo numa compra que veio com UTM. O que a Payt
devolve é um objeto em `sources`, visto na compra de teste de 26/10 (transação
`82JJPJX`), a primeira feita pela loja do app:

```json
"sources": { "utm_medium": "loja", "utm_source": "app", "utm_campaign": "oracao-sao-miguel" }
```

O `utmsDo` (`services/payt.ts`) segue lendo as outras formas plausíveis — lista
de `{name,value}`, de `{key,value}` e de `"chave=valor"` — porque um formato
observado não é contrato. Formato que não bate custa o evento
`purchase_from_app` e nada mais: quem concede o acesso é o processamento, e ele
não pode cair por causa de um campo de relatório. Foi essa tolerância que fez o
evento sair certo na primeira compra, sem ninguém ter visto o formato antes.

**Entitlement manual sobrevive ao reembolso — e confunde no teste.** O reembolso
revoga por `transaction_id` (§7), e concessão manual não tem um. No teste de
26/10 o acesso ao `manual-purificacao`, concedido à mão em 23/10, **continuou
valendo** depois do reembolso do pacote que o contém, e a Home seguiu mostrando
"também liberado para você". Não é defeito: são duas concessões diferentes para
o mesmo produto, uma de cada fonte. Mas, ao testar reembolso de bundle, vale
conferir antes se alguma parte dele já foi concedida à mão.
**A loja mostra o preço do catálogo, não o do checkout.** São dois campos
diferentes: `price_cents` é o que aparece na tela e `checkout_url` é para onde
o botão leva. No teste de staging eles divergem de propósito (R$ 197,00 na tela,
R$ 29,90 no checkout do "60 Receitas"). Em produção, divergir é erro de
catálogo — e é o tipo de erro que só aparece quando alguém reclama da cobrança.

**O e-mail de teste de compra era aleatório** e podia ser de uma pessoa real.
Virou regra no CLAUDE.md (§16): sempre endereço próprio. A limpeza exigiu apagar
o usuário de todas as tabelas e mascarar o payload.

---

## 8. O que falta para o lançamento

Em ordem de dependência. O que está pronto não aparece aqui.

| # | Falta | Depende de | Por quê trava |
|---|---|---|---|
| 1 | **Campanha**, em ondas, começando por Gmail | Leo (ok do envio de teste) | A base está importada e ainda não sabe do app |
| 2 | **Testar as fases 5 e 8 no Android** | Leo | No Android só o BlueStacks foi visto, e é a maioria do público |
| 3 | **Identidade visual** (ícones ainda são placeholder) | Leo | A raiz já é pública: o ícone aparece |

**Fora da fila por decisão do Leo** (26/10): `/privacidade`, `/termos` e o
registro de acesso. Não bloqueiam a campanha; ver "O que está aberto", item 6.

Fora da fila, se o Leo quiser: **`www` → raiz canonizado** (hoje os dois servem o
app; canonizar é uma Redirect Rule no painel) e **SNDS/JMRP da Microsoft**, para
ver de dentro o que o Outlook acha do domínio.

## 9. Comandos que a próxima sessão vai querer

```bash
npm run typecheck && npm test        # antes de dar qualquer fase por concluída
npm run dev                          # Vite + Worker, D1 e R2 locais

npm run db:migrate:staging           # aplica migrations
npm run seed:staging                 # gera e aplica o seed (idempotente)
npm run deploy:staging               # build com CLOUDFLARE_ENV + wrangler deploy

# Os mesmos existem para produção; rodaram em 23/10 e de novo em 27/10:
npm run db:migrate:production
npm run seed:production
npm run media:upload:production      # 34 áudios, 145 MB
npm run deploy:production

npm run push:teste -- --email <email> --env staging     # push de teste nos aparelhos
npm run conta:excluir -- --email <email> --env staging  # prévia; --confirmar apaga

npm run payt:last:staging            # últimos 5 postbacks, com o JSON
npm run payt:reprocess:staging X9P8DY5
npm run grant:staging <email> <produto>
node scripts/grant.ts <email> <produto> production --criar --nome Fulana --enviar-acesso
# retrato do VAPID sem os valores (tamanho, BOM, validade, par confere):
#   GET /api/admin/vapid com x-admin-key
npm run campanha:anuncio -- --env staging --limite 1 --teste-para <email> --dry-run
npm run campanha:anuncio -- --env production --limite 50 --provedores gmail   # 1ª onda: só Gmail
```

As credenciais da Cloudflare saem de `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID` no ambiente; a chave administrativa sai do `.dev.vars`
(`ADMIN_API_KEY` para staging, `ADMIN_API_KEY_PRODUCTION` para produção).

**Sem `CLOUDFLARE_API_TOKEN`, o `media:upload` reenvia tudo**: a listagem do
bucket usa a API e falha calada, então nada é pulado. Foi o que aconteceu em
27/10 — 34 áudios reenviados, sem estrago (mesmo conteúdo, mesma chave).
