use sqlx::{Pool, Postgres, Row};

pub async fn run_cleanup(pool: &Pool<Postgres>, storage_path: &str) -> anyhow::Result<()> {
    tracing::info!("Running cleanup task...");
    // Find jobs not accessed in the last 7 days
    let rows = sqlx::query(
        "DELETE FROM jobs WHERE last_accessed_at < NOW() - INTERVAL '7 days' RETURNING file_path",
    )
    .fetch_all(pool)
    .await?;

    for row in rows {
        let file_path: Option<String> = row.get("file_path");
        if let Some(path) = file_path {
            // Check if path is within storage_path to avoid any issues, though it should be.
            if path.starts_with(storage_path) {
                if let Err(e) = tokio::fs::remove_file(&path).await {
                    tracing::error!(path = %path, error = %e, "Failed to delete file during cleanup");
                } else {
                    tracing::info!(path = %path, "Deleted old file during cleanup");
                }
            }
        }
    }
    Ok(())
}
