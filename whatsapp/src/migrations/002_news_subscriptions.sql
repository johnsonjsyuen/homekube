CREATE TABLE IF NOT EXISTS news_subscriptions (
    user_id      TEXT PRIMARY KEY REFERENCES sessions(user_id),
    subscribed   BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_subscriptions_active
    ON news_subscriptions (subscribed) WHERE subscribed = true;
