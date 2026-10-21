-- Campos que vieram do pipeline de conteúdo (seed/produtos.json):
--   products.notice  aviso obrigatório na tela do produto (ex.: aviso de saúde, CLAUDE.md §14)
--   lessons.summary  frase curta da lição, usada na lista de dias
-- A 0001 já estava aplicada em staging, por isso entram como ALTER.

ALTER TABLE products ADD COLUMN notice TEXT;

ALTER TABLE lessons ADD COLUMN summary TEXT;
