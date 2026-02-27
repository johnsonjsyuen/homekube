CREATE TABLE IF NOT EXISTS economist_subscriptions (
    user_id      TEXT PRIMARY KEY,
    subscribed   BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_economist_subscriptions_active
    ON economist_subscriptions (subscribed) WHERE subscribed = true;
