-- Link de acesso direto no e-mail e código para ação sensível (CLAUDE.md §8).

-- Token pessoal que já abre a sessão, para quem recebe o e-mail de boas-vindas
-- ou o de anúncio não ter que digitar código nenhum.
--
-- O token é guardado **com hash** e a busca é pelo hash, sem o id do usuário na
-- URL. O código de login de 6 dígitos precisa do id no hash porque 6 dígitos
-- repetem entre usuários; aqui o token tem 256 bits sorteados, então o próprio
-- hash já é único e a linha é que diz de quem ele é.
CREATE TABLE access_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_access_links_user ON access_links (user_id, created_at);

-- Ação sensível (excluir conta, trocar e-mail) pede código mesmo com sessão
-- aberta. O código vai na mesma tabela, separado pelo propósito: código de
-- login não autoriza exclusão, e código de exclusão não abre sessão.
ALTER TABLE login_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
