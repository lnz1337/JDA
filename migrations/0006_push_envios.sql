-- Fase 8: trava contra lembrete duplicado (CLAUDE.md §11).
--
-- O cron roda a cada 5 minutos e pode se sobrepor: execução lenta ainda
-- enviando quando a seguinte começa. A chave primária é a trava — a linha entra
-- com INSERT OR IGNORE **antes** do envio, e só envia quem conseguiu inserir.
--
-- `data_local` é o dia no fuso do usuário (YYYY-MM-DD), não em UTC: o lembrete é
-- "uma vez por dia" para quem recebe, e em Brasília o dia vira três horas antes
-- do dia UTC.
CREATE TABLE push_envios (
  user_id TEXT NOT NULL REFERENCES users(id),
  tipo TEXT NOT NULL,              -- 'oracao_do_dia'
  data_local TEXT NOT NULL,        -- YYYY-MM-DD no fuso do usuário
  enviado_em TEXT NOT NULL,
  PRIMARY KEY (user_id, tipo, data_local)
);

-- Para a limpeza futura e para o funil: quantos lembretes saíram num dia.
CREATE INDEX idx_push_envios_data ON push_envios (tipo, data_local);
