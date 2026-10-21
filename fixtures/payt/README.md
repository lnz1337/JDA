# Fixtures do postback da Payt

> **Todos estes arquivos são SINTÉTICOS.** Foram montados a partir do formato
> descrito no [CLAUDE.md §7](../../CLAUDE.md), não de um postback real. Cada um
> carrega o campo `_nota` dizendo isso.

## Por que isso importa

O formato PayT V1 real ainda não foi observado. O código que lê o postback é
deliberadamente tolerante, e o endpoint **grava o payload cru antes de qualquer
validação de conteúdo** — assim o primeiro postback de verdade fica inspecionável
mesmo que o processamento falhe.

## Como substituir por payloads reais

1. Faça uma compra de teste no checkout da Payt.
2. `npm run payt:last:staging` mostra os últimos 5 eventos com o JSON recebido.
3. Salve o JSON real por cima da fixture correspondente, trocando a
   `integration_key` por `chave-de-teste-sintetica` e anonimizando e-mail,
   telefone e nome.
4. Rode `npm test`. O que quebrar é exatamente a diferença entre o que supusemos
   e o que a Payt manda.

**Nunca** comitar a `integration_key` real: ela vive só como secret
(`wrangler secret put PAYT_INTEGRATION_KEY --env staging`).

## O que cada arquivo cobre

| Arquivo | Caso |
|---|---|
| `pedido-pago.json` | compra do front, concede entitlement |
| `pedido-com-order-bump.json` | order bump junto do pedido |
| `upsell-bundle-agrupado.json` | upsell com `product.items` (bundle agrupado) |
| `pedido-sku-desconhecido.json` | `sku` que não existe, resolvido por `product_payt_map` |
| `reembolso.json` | revoga os entitlements da transação |
| `chargeback.json` | idem |
| `reembolso-parcial.json` | **não** revoga; vai para a fila de revisão |
| `assinatura-ativada.json` | upsert em `subscriptions` |
| `assinatura-renovada.json` | idem |
| `assinatura-anual-ativada.json` | `periodicity: 1 year` vira plano `anual` |
| `assinatura-atrasada.json` | status `overdue` (carência de 3 dias vale pela §6) |
| `assinatura-cancelada.json` | status `canceled_by_customer` |
| `fake-email.json` | `fake_email: true`, identifica pelo telefone |
| `aguardando-pagamento.json` | só registra |
| `carrinho-abandonado.json` | só registra |
| `chave-invalida.json` | `integration_key` errada → 401, nada gravado |
