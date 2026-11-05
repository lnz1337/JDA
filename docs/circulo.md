# Círculo de São Miguel (fase 7): o que lançar até 15/11

O Círculo é o que vem depois dos 19 dias. Por volta de **15/11** os primeiros
clientes chegam ao dia 19, e hoje o app não tem nada para eles depois disso: o
lembrete diário para sete dias depois (§11). A novena de novembro começa em
**18/11**. Este arquivo diz o que entra no lançamento, o que fica para depois e o
que depende do Leo. Vale junto com o CLAUDE.md; as seções que mudarem (§3, §5,
§6, §9) são atualizadas no mesmo commit da mudança.

## Decisões do Leo (05/11)

- As três amostras do devocional estão **aprovadas**.
- **O foco é o plano anual.**
- A assinatura da Payt **só aceita cartão**.
- **Primeiro só texto**: o Círculo abre sem áudio. Os áudios entram depois.

**Ainda em aberto, com o Leo:**

1. **Anual como pagamento único de 12 meses ou como assinatura.** O pagamento
   único aceita Pix e cartão parcelado e usa o fluxo de compra que já funciona; a
   assinatura renova sozinha, mas só no cartão, e o fluxo dela nunca recebeu um
   postback real. O app aceita os dois (ver "Quem tem o Círculo"); o que muda é o
   texto da página e o cadastro no catálogo.
2. **Mensal**: se existe no lançamento (como assinatura no cartão).
3. De cada plano: **link do checkout, preço e código** da Payt.
4. **Como se cancela a assinatura**: se a Payt tem área do cliente ou se é pelo
   suporte. O texto da página depende disso.

## O que o Círculo dá no lançamento

1. **Um devocional por dia**, pelo dia do mês: 31 textos, com leitura, reflexão,
   oração, prática e intenção.
2. **A novena do mês**: em novembro, a de Nossa Senhora das Graças, de 18 a 26.

**Não anunciar o que ainda não existe**: nem mural, nem áudio. O lembrete diário
do Círculo (P3, abaixo) só entra no texto da página depois de estar no ar.

## O conteúdo (pipeline, já no repositório)

| Fonte da verdade | Gera | Com |
|---|---|---|
| `conteudo/circulo/devocional-diario.md` e `conteudo/circulo/novena-nossa-senhora-das-gracas.md` | `seed/circulo.json` | `python3 conteudo/gerar_seed_circulo.py` |

- Mesmo formato do `seed/produtos.json` (`products`, `programs`, `lessons`): dois
  produtos (`circulo-devocional` e `novena-nossa-senhora-das-gracas`), dois
  programas e 40 dias. Os dois com `listed: 0`: quem aparece nos Tesouros é o
  Círculo, não os conteúdos soltos.
- O programa traz dois valores novos de `unlock_rule` — `mes` (o devocional) e
  `calendario` (a novena) — e o `available_from` da novena (`2026-11-18`).
- `audio_key` é nulo em todos os dias: a lição mostra o texto sem player.
  `audio_script_ready` diz quem já tem roteiro (os dias 1 a 3 do devocional).
- O corpo sai com os rótulos da jornada (`**Leitura do dia:**`, `**Prática de
  hoje:**`, `**Intenção:**`), e a oração vai dentro do trecho da reflexão: a
  lição em passos (R2) separa igual.
- Do lado da aplicação: o `seed-sql.ts` lê o `circulo.json` como lê o
  `produtos.json`; `requires_subscription = 1` dos dois entra no
  `seed/catalogo.json` (dado comercial); o CHECK de `programs.unlock_rule` aceita
  os valores novos (migration); o §3 do CLAUDE.md ganha a linha da tabela acima.

## Liberação

- **`mes` (devocional)**: "hoje" é o dia do mês no fuso da pessoa. O dia *d*
  está aberto quando *d* ≤ hoje. Dias 29, 30 e 31 não aparecem no mês que não os
  tem. Os dias depois de hoje aparecem bloqueados **dizendo quando abrem**
  ("Libera amanhã", "Libera dia 20"), como manda o §6. Sem matrícula: o
  calendário é o mesmo para todo mundo.
- **`calendario` (novena)**: o dia *N* abre em `available_from + (N − 1)` dias,
  no fuso da pessoa. Três dias antes do início, o assinante já vê "Começa em
  18/11", sem conteúdo. Terminada a novena, ela continua aberta para quem tem o
  Círculo.
- O `GET /api/licoes/:id` confere o acesso **e** o dia, como na jornada.
- **Progresso num ciclo que se repete**: a chave de `progress` é
  `(user_id, lesson_id)`, e o dia 5 de dezembro é a mesma lição do dia 5 de
  novembro. No `mes`, "concluído" quer dizer `completed_at` **no dia de hoje**,
  no fuso da pessoa; o "Concluí" regrava a data, e o `lesson_completed` sai uma
  vez por dia de calendário, não uma vez para sempre.

## Quem tem o Círculo

`circuloValido(user)` = `assinaturaValida(user)` (§6) **ou** um entitlement ativo
e **não vencido** de um plano do Círculo. É o que o `hasAccess` usa para os
conteúdos com `requires_subscription = 1`.

- **Pagamento único de 12 meses**: o entitlement ganha `expires_at` (migration).
  O postback pago grava `expires_at = max(agora, maior validade ativa do Círculo)
  + 365 dias`: quem renova antes de vencer não perde dias. Reembolso e chargeback
  revogam como qualquer compra. A renovação é uma campanha perto do 11º mês
  (depois).
- **Assinatura** (mensal ou anual, no cartão): o §7 já trata os `subscription_*`,
  mas só com fixtures sintéticas. Antes de anunciar: **compra de teste real** com
  o cartão e o e-mail do Leo, conferir os postbacks com `npm run
  payt:last:staging`, trocar as fixtures pelo formato real e testar o
  cancelamento.
- Nos dois casos: **compra de teste** e **reembolso** em staging, com o e-mail
  do Leo (nunca inventado, §16).

## Onde o Círculo aparece (o §9 muda)

- **Fim do dia 19**: na tela que aparece ao concluir o dia 19 (a das velas, se a
  R2 já estiver no ar), **embaixo** da celebração, um cartão do Círculo. **Não um
  modal por cima**: a pessoa acabou de rezar o último dia, e primeiro vem a
  celebração, depois o convite.
- **Home, depois do dia 19, sem o Círculo**: um cartão abaixo do cartão do dia,
  com "Agora não" que esconde por 7 dias (`offer_dismissed`), como os pacotes.
- **Tesouros**: "Círculo de São Miguel" no topo de "Para você". Para quem tem,
  "Já é seu" mostra o devocional, a novena do mês e a validade ("Círculo ativo
  até 05/11/2027" no pagamento único; "Assinatura ativa" na assinatura).
- **Antes do dia 19, nada na Home**: valem as regras de hoje (dias 1 a 4 sem
  oferta, as janelas dos pacotes). Quem quiser antes acha nos Tesouros.
- **O anual vem primeiro e destacado.** O mensal, se existir, é um link
  embaixo.
- Eventos de sempre: `offer_viewed`, `offer_clicked`, `offer_dismissed`, com
  `oferta: 'circulo'`; a compra conta no `purchase_from_app` com o `canal`.
- A linha do §9 "3 a 10 dias após concluir, plano anual com desconto" vira o
  segundo convite do Círculo (cartão, push único e e-mail) e fica para a fase 10.

## Textos

Números (preço, parcelas, valor por mês) saem do catálogo, nunca escritos à mão
no componente. Nada de graça garantida nem de proteção garantida (§14).

### A página do Círculo (`/loja/circulo`)

> **CÍRCULO DE SÃO MIGUEL**
>
> # Continue rezando com São Miguel
>
> A jornada de 19 dias termina, mas a oração não precisa parar. No Círculo, você
> tem um devocional para cada dia do mês e reza a novena do mês junto com os
> outros participantes.
>
> ✓ **Um devocional por dia**: uma leitura da Bíblia, uma reflexão curta, uma
> oração e uma prática. Leva uns cinco minutos.
>
> ✓ **A novena do mês**: em novembro, a Novena de Nossa Senhora das Graças, de 18
> a 26.
>
> ✓ **Tudo aqui no app**, junto com a sua jornada e os seus Tesouros.

Depois dos três itens, uma **prévia do devocional de hoje**: rótulo "O
DEVOCIONAL DE HOJE", o título, o resumo e o primeiro parágrafo da reflexão, e
"Para ler inteiro, entre no Círculo". É o que o §4 chama de prévia.

Plano anual, em destaque (cartão com borda dourada e o botão dourado):

- **Se for pagamento único:** "**Plano anual** · R$ 147 · à vista no Pix ou em
  até 12x no cartão · 12 meses de Círculo, **sem renovação automática**".
  Botão: **"Quero o plano anual"**.
- **Se for assinatura:** "**Plano anual** · R$ 147 por ano, no cartão · sai por
  R$ 12,25 por mês · renova a cada ano". Mesmo botão.

Mensal, se existir, em texto simples abaixo: "Prefere pagar por mês? **R$ 29,90
por mês**, no cartão."

Rodapé: "O pagamento é feito na Payt, com o seu e-mail já preenchido." e, na
assinatura, a linha de como cancelar (pendente com o Leo).

### O cartão do fim do dia 19

> Você rezou os 19 dias com São Miguel. Se quiser continuar todos os dias, o
> Círculo de São Miguel tem um devocional para cada dia do mês e a novena do mês.
>
> **[Conhecer o Círculo]** · Agora não

### O cartão da Home

> **CÍRCULO DE SÃO MIGUEL**
> A oração continua todos os dias.
> **Conhecer ›** · Agora não

## Para quem tem o Círculo

- **Home**: enquanto a jornada estiver aberta, o cartão de hoje é o da jornada e
  o devocional vem como segundo cartão. Depois do dia 19, o devocional do dia vira
  o cartão principal ("AGORA · 5 DE NOVEMBRO · DEVOCIONAL"). Nos dias da novena,
  o dia dela vem logo abaixo.
- **Lição**: sem áudio, o passo 1 mostra a leitura, a reflexão e a oração; o
  resto segue a R2.
- **Lista**: o devocional mostra o mês corrente ("Novembro", dias 1 a 30, hoje em
  destaque); não usa o mapa da jornada.

## Ordem

| | O quê | Até |
|---|---|---|
| **P1** | Seed do Círculo, regras `mes` e `calendario`, `circuloValido` com o modelo que o Leo escolher, página do Círculo, cartão do fim do dia 19, cartão da Home, Tesouros; compra de teste e reembolso em staging | 13/11, para sobrar folga até 15/11 |
| **P2** | Perfil: estado do Círculo (validade, ou assinatura e próxima cobrança), como cancelar, horário do lembrete, nome, suporte, sair, excluir conta com código e o aviso de assinatura (§14) | logo depois |
| **P3** | Lembrete do Círculo: o cron (§11) ganha o tipo `circulo` — para quem tem o Círculo, no horário dela, com o `push_text` do devocional do dia (ou o da novena, nos dias dela), se ainda não concluiu hoje. **No máximo um lembrete por dia**: se a jornada ainda manda o dela naquele dia, o do Círculo não sai. A trava `push_envios` vale | antes de a página prometer o lembrete |
| Depois | Áudio do devocional e da novena; mural (fase 9); segundo convite e e-mail (fase 10); renovação do anual | — |

Cada item em staging primeiro, com o roteiro de teste para o Leo no iPhone.
Produção só com o ok dele.
