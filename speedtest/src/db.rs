use sea_orm::{
    ActiveModelTrait, DatabaseConnection, EntityTrait, QueryOrder, QuerySelect, Set,
    SqlxPostgresConnector,
};
use sqlx::postgres::PgPoolOptions;
use std::env;
use anyhow::Result;
use crate::speedtest::SpeedtestResult;
use crate::entities::{ActiveModel, Entity as SpeedtestResults, Column as SpeedtestColumn};
use log;

#[derive(Clone)]
pub struct Db {
    conn: DatabaseConnection,
}

impl Db {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");

        // Create sqlx pool for migrations
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await?;

        log::info!("Running database migrations...");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await?;
        log::info!("Database migrations complete.");

        // Convert pool to SeaORM connection
        let conn = SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

        Ok(Self { conn })
    }

    pub async fn insert_result(&self, result: &SpeedtestResult) -> Result<()> {
        let new_result = ActiveModel {
            server_id: Set(result.server_id),
            server_name: Set(result.server_name.clone()),
            server_country: Set(result.server_country.clone()),
            latency_ms: Set(result.latency_ms),
            download_bandwidth: Set(result.download_bandwidth),
            upload_bandwidth: Set(result.upload_bandwidth),
            download_bytes: Set(result.download_bytes),
            upload_bytes: Set(result.upload_bytes),
            result_url: Set(result.result_url.clone()),
            ..Default::default() // Let DB handle ID and Timestamp
        };

        new_result.insert(&self.conn).await?;

        Ok(())
    }

    pub async fn get_recent_results(&self) -> Result<Vec<crate::api::SpeedtestResultResponse>> {
        let results = SpeedtestResults::find()
            .order_by_desc(SpeedtestColumn::Timestamp)
            .limit(100)
            .all(&self.conn)
            .await?;

        let response = results.into_iter().map(|r| crate::api::SpeedtestResultResponse {
            timestamp: r.timestamp.with_timezone(&chrono::Utc),
            server_name: r.server_name.unwrap_or_default(),
            server_country: r.server_country.unwrap_or_default(),
            latency_ms: r.latency_ms.unwrap_or_default(),
            download_bandwidth: r.download_bandwidth.unwrap_or_default(),
            upload_bandwidth: r.upload_bandwidth.unwrap_or_default(),
        }).collect();

        Ok(response)
    }
}
