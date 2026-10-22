# Fixtures do postback da Payt

> Os arquivos `real-*.json` são **postbacks reais** capturados em staging (com a
> `integration_key` mascarada e, no carrinho, os dados do cliente trocados por
> fictícios). Os demais são **sintéticos**, montados a partir do
> [CLAUDE.md §7](../../CLAUDE.md) e já ajustados ao formato real observado. O
> campo `_nota` de cada arquivo diz qual é qual.

## Por que isso importa

O código que lê o postback é deliberadamente tolerante, e o endpoint **grava o
payload antes de qualquer validação de conteúdo** — assim um postback de formato
inesperado fica inspecionável mesmo que o processamento falhe. Foi exatamente
assim que o formato real abaixo foi descoberto.

## O que já foi observado do formato real

Capturado em staging em 21/10/2026 (`real-pedido-pago.json`, que é o postback de
teste do próprio painel da Payt):

- `transaction_id`, `status`, `type`, `test` e `updated_at` ficam no **topo**;
  `payment_status` fica dentro de `transaction`.
- `product.sku`, `product.code`, `product.items[]` e `order_bumps[].product`
  são como a §7 descreve — a extração dos produtos funcionou de primeira.
- **O `sku` é gerado pela Payt** (`793269e47eb75`), não é um slug escolhido por
  nós. Isso responde a pendência da §17: o caminho normal vai ser o
  `product_payt_map` pelo `product.code`.
- **As datas vêm em horário de Brasília, sem fuso**: `"2026-10-21 19:06:20.000000"`.
  Um carrinho abandonado com `updated_at` 19:06:20 chegou às 22:06:21Z — três
  horas exatas. O Worker normaliza para ISO UTC na borda (`paytParaIso`).
- O payload traz a `integration_key`. Ela é **mascarada como `"***"`** antes de
  ir para o banco: o segredo não fica guardado nem aparece no `payt:last`.
  Por isso as fixtures reais não podem ser postadas como estão — os testes
  repõem a chave sintética.

## Dois mapeamentos diferentes

| Mapeamento | Onde mora | Vale em |
|---|---|---|
| `RVEEJ8` → `jornada-meu-anjo` | `seed/catalogo.json`, campo `payt_map` | **todos**, inclusive produção |
| `LJ7KEP` → `jornada-meu-anjo` | só no D1 de staging, à mão | **só staging** |

`RVEEJ8` é o `product.code` real do produto "Jornada com meu Anjo", capturado de
um carrinho abandonado antes de o evento ser apagado — está preservado em
`real-carrinho-abandonado.json`.

`LJ7KEP` é o "60 Receitas - Saladas No Pote", um produto que **não é nosso**,
usado só para exercitar o fluxo de compra. Em produção, mapear o código de um
produto para outro daria acesso errado a quem comprou.

## Mapeamento só de staging (`product_payt_map`)

O postback de staging está restrito ao produto **"60 Receitas - Saladas No Pote"**,
que está inativo e não está à venda. Como ele não existe no nosso catálogo, o
`product.code` dele é mapeado para `jornada-meu-anjo` **apenas no staging**, por
comando manual:

```bash
npx wrangler d1 execute DB --env staging --remote --command "INSERT INTO product_payt_map (payt_code, product_id) VALUES ('<CODE>', 'jornada-meu-anjo')"
```

**Esse mapeamento nunca entra no seed e nunca vai para produção.** Ele existe só
para que um postback de teste exercite o caminho completo (resolver produto →
criar usuário → conceder entitlement) sem precisar de uma compra real do produto
de verdade. Em produção, mapear o código de um produto para outro concederia
acesso errado a quem comprou.

Já cadastrado em 21/10/2026: **`LJ7KEP` → `jornada-meu-anjo`**, o `product.code`
do "60 Receitas - Saladas No Pote". Conferido por
`SELECT * FROM product_payt_map` no staging e ausente do seed.

## Como substituir por payloads reais

1. Faça uma compra de teste no checkout da Payt.
2. `npm run payt:last:staging` mostra os últimos 5 eventos com o JSON recebido.
3. Salve o JSON por cima da fixture correspondente. A `integration_key` já vem
   gravada como `"***"`; anonimize nome, e-mail, CPF, telefone e IP do cliente.
   Nos testes, `comChave()` repõe a chave sintética na hora de postar.
4. Rode `npm test`. O que quebrar é exatamente a diferença entre o que supusemos
   e o que a Payt manda.

**Nunca** comitar a `integration_key` real: ela vive só como secret
(`wrangler secret put PAYT_INTEGRATION_KEY --env staging`). O Worker a mascara
antes de gravar, mas a fixture é um arquivo versionado — confira antes de salvar.

**Postback de cliente real não fica em staging.** Carrinho abandonado da oferta
de verdade chegou aqui com nome, e-mail, CPF e IP; esses eventos foram apagados e
o que virou fixture está anonimizado.

## O que cada arquivo cobre

| Arquivo | Caso |
|---|---|
| `pedido-pago.json` | **REAL e anonimizado** — compra de teste paga; só resolve via `product_payt_map` |
| `pedido-com-order-bump.json` | order bump junto do pedido |
| `upsell-bundle-agrupado.json` | upsell com `product.items` (bundle agrupado) |
| `pedido-sku-desconhecido.json` | `sku` que não existe, resolvido por `product_payt_map` |
| `reembolso.json` | revoga os entitlements da transação (aponta para o `pedido-pago.json`) |
| `chargeback.json` | idem |
| `reembolso-parcial.json` | **não** revoga; vai para a fila de revisão |
| `assinatura-ativada.json` | upsert em `subscriptions` |
| `assinatura-renovada.json` | idem |
| `assinatura-anual-ativada.json` | `periodicity: 1 year` vira plano `anual` |
| `assinatura-atrasada.json` | status `overdue` (carência de 3 dias vale pela §6) |
| `assinatura-cancelada.json` | status `canceled_by_customer` |
| `fake-email.json` | `fake_email: true`, identifica pelo telefone |
| `aguardando-pagamento.json` | só registra |
| `real-pedido-pago.json` | **REAL** — formato observado, produtos fictícios da Payt |
| `real-carrinho-abandonado.json` | **REAL e anonimizado** — `lost_cart` sem `transaction_id` |
| `chave-invalida.json` | `integration_key` errada → 401, nada gravado |
