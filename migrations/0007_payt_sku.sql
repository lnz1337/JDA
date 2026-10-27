-- Lançamento: sku da Payt → nosso produto (CLAUDE.md §7, passo 6).
--
-- O relatório de vendas em .xlsx não traz o product.code, só o sku, e o
-- postback pode um dia chegar sem code. Com os dois mapas, um identificador
-- cobre o outro: o resolvedor tenta o sku primeiro e o code depois.
--
-- Mesma regra do product_payt_map: o seed só faz UPSERT, nunca apaga o que não
-- está declarado.
CREATE TABLE product_payt_sku (
  payt_sku TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id)
);
