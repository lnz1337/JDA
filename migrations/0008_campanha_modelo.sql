-- Qual texto cada pessoa recebeu na campanha (lançamento, primeira onda).
--
-- O anúncio tem dois modelos: o completo (conteudo/emails/anuncio-app.md) e o
-- curto (anuncio-app-curto.md), que testa se o Gmail o põe em Principal em vez
-- de Promoções. A chave da campanha é a mesma nos dois — quem recebeu um nunca
-- recebe o outro —, então é esta coluna que deixa comparar depois.
--
-- NULL é o que saiu antes de a coluna existir: o modelo completo.
ALTER TABLE campaign_sends ADD COLUMN model TEXT;
