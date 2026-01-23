CREATE TABLE IF NOT EXISTS speedtest_results (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    server_id INTEGER,
    server_name TEXT,
    server_country TEXT,
    latency_ms REAL,
    download_bandwidth INTEGER,
    upload_bandwidth INTEGER,
    download_bytes INTEGER,
    upload_bytes INTEGER,
    result_url TEXT
);
