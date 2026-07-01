-- ADS Tech B2C Schema — run in Railway Postgres console

CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(120)  NOT NULL,
  email            VARCHAR(255)  NOT NULL UNIQUE,
  phone            VARCHAR(20),
  password_hash    TEXT          NOT NULL,
  is_verified      BOOLEAN       NOT NULL DEFAULT FALSE,
  otp_code         VARCHAR(6),
  token_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS quotes_orders (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items_json       JSONB         NOT NULL DEFAULT '[]',
  status           VARCHAR(30)   NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','reviewing','approved','rejected','ordered')),
  whatsapp_sent_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes_orders (user_id);

CREATE TABLE IF NOT EXISTS repairs (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_model      VARCHAR(120)  NOT NULL,
  issue_description TEXT          NOT NULL,
  status            VARCHAR(30)   NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','diagnosing','in_repair','ready','completed','cancelled')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repairs_user ON repairs (user_id);
