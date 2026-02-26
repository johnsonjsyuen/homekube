CREATE TABLE IF NOT EXISTS auth_creds (
    user_id    TEXT PRIMARY KEY,
    creds_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_keys (
    user_id  TEXT NOT NULL,
    category TEXT NOT NULL,
    key_id   TEXT NOT NULL,
    key_json JSONB NOT NULL,
    PRIMARY KEY (user_id, category, key_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    user_id           TEXT PRIMARY KEY,
    phone_number      TEXT,
    status            TEXT NOT NULL DEFAULT 'disconnected',
    whatsapp_jid      TEXT,
    error_message     TEXT,
    paired_at         TIMESTAMPTZ,
    last_connected_at TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id             SERIAL PRIMARY KEY,
    user_id        TEXT NOT NULL,
    direction      TEXT NOT NULL,
    remote_jid     TEXT NOT NULL,
    message_text   TEXT,
    message_id     TEXT,
    status         TEXT DEFAULT 'sent',
    source_service TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
