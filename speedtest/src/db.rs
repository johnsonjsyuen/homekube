use sqlx::postgres::PgPoolOptions;
use sqlx::{Pool, Postgres};
use std::env;
use anyhow::Result;
use crate::speedtest::SpeedtestResult;
use log;

#[derive(Clone)]
pub struct Db {
    pool: Pool<Postgres>,
}

impl Db {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await?;

        log::info!("Running database migrations...");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await?;
        log::info!("Database migrations complete.");

        Ok(Self { pool })
    }

    pub async fn insert_result(&self, result: &SpeedtestResult) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO speedtest_results (
                server_id, server_name, server_country, latency_ms,
                download_bandwidth, upload_bandwidth, download_bytes, upload_bytes, result_url
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
        )
        .bind(result.server_id)
        .bind(result.server_name.clone())
        .bind(result.server_country.clone())
        .bind(result.latency_ms)
        .bind(result.download_bandwidth)
        .bind(result.upload_bandwidth)
        .bind(result.download_bytes)
        .bind(result.upload_bytes)
        .bind(result.result_url.clone())

        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
