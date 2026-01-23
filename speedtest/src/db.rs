use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tokio_postgres::NoTls;
use std::env;
use anyhow::Result;
use crate::speedtest::SpeedtestResult;
use log;

// Embed migrations
mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

#[derive(Clone)]
pub struct Db {
    pool: Pool,
}

impl Db {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");

        let pg_config: tokio_postgres::Config = database_url.parse()?;
        let mgr_config = ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        };
        let mgr = Manager::from_config(pg_config, NoTls, mgr_config);
        let pool = Pool::builder(mgr).max_size(5).build()?;

        log::info!("Running database migrations...");
        let mut client = pool.get().await?;
        embedded::migrations::runner().run_async(&mut **client).await?;
        log::info!("Database migrations complete.");

        Ok(Self { pool })
    }

    pub async fn insert_result(&self, result: &SpeedtestResult) -> Result<()> {
        let client = self.pool.get().await?;
        client.execute(
            r#"
            INSERT INTO speedtest_results (
                server_id, server_name, server_country, latency_ms,
                download_bandwidth, upload_bandwidth, download_bytes, upload_bytes, result_url
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            &[
                &result.server_id,
                &result.server_name,
                &result.server_country,
                &result.latency_ms,
                &result.download_bandwidth,
                &result.upload_bandwidth,
                &result.download_bytes,
                &result.upload_bytes,
                &result.result_url,
            ]
        )
        .await?;

        Ok(())
    }

    pub async fn get_recent_results(&self) -> Result<Vec<crate::api::SpeedtestResultResponse>> {
        let client = self.pool.get().await?;
        let rows = client.query(
            r#"
            SELECT 
                timestamp,
                server_name,
                server_country,
                latency_ms,
                download_bandwidth,
                upload_bandwidth
            FROM speedtest_results
            ORDER BY timestamp DESC
            LIMIT 100
            "#,
            &[]
        )
        .await?;

        let mut results = Vec::new();
        for row in rows {
            results.push(crate::api::SpeedtestResultResponse {
                timestamp: row.get("timestamp"),
                server_name: row.get("server_name"),
                server_country: row.get("server_country"),
                latency_ms: row.get("latency_ms"),
                download_bandwidth: row.get("download_bandwidth"),
                upload_bandwidth: row.get("upload_bandwidth"),
            });
        }

        Ok(results)
    }
}
