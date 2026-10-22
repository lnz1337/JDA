-- Fase 4: login por código, sessão e e-mails.

-- Limite de pedidos de código por e-mail e por IP (CLAUDE.md §8).
-- A 0001 não guardava quando o código foi pedido nem de onde.
ALTER TABLE login_codes ADD COLUMN created_at TEXT;
ALTER TABLE login_codes ADD COLUMN ip TEXT;

CREATE INDEX idx_login_codes_user ON login_codes (user_id, created_at);
CREATE INDEX idx_login_codes_ip ON login_codes (ip, created_at);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_entitlements_user ON entitlements (user_id, status);

-- Quem pediu para não receber aviso de campanha. Não afeta código de login nem
-- e-mail de compra (CLAUDE.md §14: o contato transacional continua).
ALTER TABLE users ADD COLUMN marketing_opt_out_at TEXT;

-- Uma linha por campanha e usuário: nunca reenvia e retoma de onde parou.
CREATE TABLE campaign_sends (
  campaign TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error TEXT,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (campaign, user_id)
);

CREATE INDEX idx_campaign_sends_status ON campaign_sends (campaign, status);
