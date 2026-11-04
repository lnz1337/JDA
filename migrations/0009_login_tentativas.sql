-- Entrada sem código (docs/entrada-sem-codigo.md): o limite de tentativas.
--
-- Sem código, quem erra o celular tenta de novo — e quem quer descobrir se um
-- número é cliente também. Cada tentativa de entrar vira uma linha, por IP e por
-- identificador, e o limite conta a última hora: 10 de cada.
--
-- `chave` é 'ip:<ip>' ou 'id:<sha256 do celular ou e-mail normalizado>'. O
-- identificador vai com hash: a tabela é só para contar, e não precisa guardar
-- o número nem o e-mail de ninguém.
CREATE TABLE login_tentativas (
  id TEXT PRIMARY KEY,
  chave TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_login_tentativas ON login_tentativas (chave, created_at);
