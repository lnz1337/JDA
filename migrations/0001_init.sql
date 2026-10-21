-- Migration inicial: modelo de dados da seção 5 do CLAUDE.md.
-- IDs são TEXT (ULID ou slug), datas em ISO 8601 UTC, valores em centavos.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,                 -- lowercase; pode ser NULL se fake_email
  phone TEXT,                        -- só dígitos
  name TEXT,
  payt_customer_code TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  prayer_hour INTEGER NOT NULL DEFAULT 7,   -- 0..23, hora local do push
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- token opaco em cookie httpOnly
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,               -- slug; DEVE ser igual ao SKU cadastrado na Payt
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('program','bundle','subscription')),
  description_md TEXT,
  price_cents INTEGER,
  checkout_url TEXT,                 -- link de checkout Payt
  cover_key TEXT,                    -- R2
  requires_subscription INTEGER NOT NULL DEFAULT 0,  -- conteúdo incluso no Círculo
  listed INTEGER NOT NULL DEFAULT 1, -- aparece na loja
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_payt_map (      -- fallback quando SKU não bate: product.code da Payt → produto
  payt_code TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id)
);

CREATE TABLE bundle_items (          -- ex.: UP1 = oração + manual + mapa
  bundle_id TEXT NOT NULL REFERENCES products(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  PRIMARY KEY (bundle_id, product_id)
);

CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  title TEXT NOT NULL,
  unlock_rule TEXT NOT NULL CHECK (unlock_rule IN ('daily','all')),
  total_days INTEGER NOT NULL,
  available_from TEXT                -- novena do mês do Círculo: só aparece a partir desta data
);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  day INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT,
  audio_key TEXT,
  pdf_key TEXT,
  duration_s INTEGER,
  push_text TEXT,                    -- texto do push daquele dia (seção 11)
  bonus_audio_key TEXT,              -- faixa extra; ex.: hino no dia 19
  bonus_title TEXT,
  UNIQUE (program_id, day)
);

CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  source TEXT NOT NULL CHECK (source IN ('payt','manual')),
  transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (user_id, product_id, transaction_id)
);

CREATE TABLE subscriptions (
  code TEXT PRIMARY KEY,             -- subscription.code da Payt
  user_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL,                -- 'mensal' | 'anual' (derivado de periodicity)
  status TEXT NOT NULL,              -- espelha subscription.status da Payt
  next_charge_at TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE enrollments (
  user_id TEXT NOT NULL REFERENCES users(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, program_id)
);

CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE payt_events (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,   -- sha256(transaction_id|status|payment_status|updated_at)
  transaction_id TEXT,
  status TEXT,
  payment_status TEXT,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error TEXT
);

CREATE TABLE intentions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,                -- máx. 280 chars
  status TEXT NOT NULL CHECK (status IN ('visible','pending','hidden')),
  prayer_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE intention_prayers (
  intention_id TEXT NOT NULL REFERENCES intentions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (intention_id, user_id)
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_success_at TEXT
);

CREATE TABLE events (                -- analytics simples
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,                -- ex.: lesson_completed, offer_viewed, offer_clicked
  props_json TEXT,
  created_at TEXT NOT NULL
);
