CREATE TABLE IF NOT EXISTS digest_subscriptions (
    user_id      TEXT NOT NULL,
    digest_type  TEXT NOT NULL,
    subscribed   BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, digest_type)
);

CREATE INDEX IF NOT EXISTS idx_digest_subscriptions_active
    ON digest_subscriptions (digest_type) WHERE subscribed = true;
