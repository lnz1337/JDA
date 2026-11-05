-- Destinatário suprimido pelo Cloudflare (05/11).
--
-- "This email address has been suppressed due to repeated bounces or because it
-- reported your emails as spam": o Cloudflare recusa antes de enviar. Não é
-- falha de entrega, e contar como falha parou a 2ª onda do lembrete-app em 9
-- envios (1 em 10 passa da trava de 5%).
--
-- 1. `users.email_suprimido_at`: o endereço sai da seleção de toda campanha.
--    O transacional (boas-vindas, código de ação sensível) não olha esta
--    coluna e continua tentando. Trocar o e-mail limpa a marca.
-- 2. `campaign_sends.status` ganha 'suppressed', para o balanço separar
--    suprimido de falha. SQLite não altera CHECK: a tabela é refeita, com os
--    mesmos dados, e quem ninguém referencia pode ser trocada sem cuidado de FK.

ALTER TABLE users ADD COLUMN email_suprimido_at TEXT;

CREATE TABLE campaign_sends_nova (
  campaign TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed')),
  error TEXT,
  sent_at TEXT NOT NULL,
  model TEXT,
  PRIMARY KEY (campaign, user_id)
);

INSERT INTO campaign_sends_nova (campaign, user_id, status, error, sent_at, model)
SELECT campaign, user_id,
       CASE WHEN status = 'failed' AND error LIKE '%has been suppressed%' THEN 'suppressed' ELSE status END,
       error, sent_at, model
  FROM campaign_sends;

DROP TABLE campaign_sends;
ALTER TABLE campaign_sends_nova RENAME TO campaign_sends;
CREATE INDEX idx_campaign_sends_status ON campaign_sends (campaign, status);

-- Os suprimidos que já apareceram (os dois da 2ª onda do lembrete, 05/11).
UPDATE users
   SET email_suprimido_at = (
         SELECT MIN(c.sent_at) FROM campaign_sends c
          WHERE c.user_id = users.id AND c.status = 'suppressed')
 WHERE id IN (SELECT user_id FROM campaign_sends WHERE status = 'suppressed');
