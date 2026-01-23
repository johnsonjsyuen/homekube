mod api;
mod db;
mod speedtest;

use crate::db::Db;
use crate::speedtest::run_speedtest;
use anyhow::Result;
use dotenvy::dotenv;
use log::{error, info};
use tokio_cron_scheduler::{Job, JobScheduler};

#[tokio::main]
async fn main() -> Result<()> {
    dotenv().ok();
    env_logger::init();

    info!("Starting Speedtest App");

    let db = Db::new().await?;
    let sched = JobScheduler::new().await?;

    // Define target servers
    // Local (None), Los Angeles, Hong Kong, New York, London
    // Note: These IDs might need to be updated.
    let targets = vec![
        ("Local", None),
        ("Los Angeles", Some(18229)), // Starry
        ("Hong Kong", Some(13538)),   // CSL
        ("New York", Some(13098)),    // Pilot Fiber
        ("London", Some(30690)),      // Community Fibre
    ];

    // Clone for the closure
    let db_clone = db.clone();
    let targets_clone = targets.clone();

    // Run every 10 minutes: "0 1/10 * * * *" (sec min hour day month day_of_week)
    // Or simpler: "0 */10 * * * *"
    let job = Job::new_async("0 */10 * * * *", move |_uuid, _l| {
        let db = db_clone.clone();
        let targets = targets_clone.clone();
        Box::pin(async move {
            info!("Starting scheduled speedtest cycle");
            for (name, server_id) in targets {
                info!("Running speedtest for {}", name);
                match run_speedtest(server_id) {
                    Ok(result) => {
                        info!(
                            "Speedtest for {} successful: {} ms latency, {} Mbps down, {} Mbps up, Result URL: {}",
                            name,
                            result.ping.latency,
                            result.download.bandwidth / 125000,
                            result.upload.bandwidth / 125000,
                            result.result.url
                        );

                        if let Err(e) = db.insert_result(&result).await {
                            error!("Failed to insert result for {}: {}", name, e);
                        }
                    }
                    Err(e) => {
                        error!("Failed to run speedtest for {}: {}", name, e);
                    }
                }
            }
            info!("Finished scheduled speedtest cycle");
        })
    })?;

    sched.add(job).await?;

    info!("Scheduler started");
    sched.start().await?;

    // Create HTTP server
    let db_for_api = std::sync::Arc::new(db.clone());
    let app = api::create_router(db_for_api);
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    info!("API server listening on port {}", port);

    // Run once immediately on startup for verification
    tokio::spawn(async move {
        info!("Running initial startup speedtest cycle");
        let targets = vec![
             ("Local", None),
        ];
        for (name, server_id) in targets {
             info!("Running initial speedtest for {}", name);
             // We reuse the logic, but just for local to test quickly
             match run_speedtest(server_id) {
                 Ok(result) => {
                     info!(
                         "Initial speedtest for {} successful: {} ms latency, {} Mbps down, {} Mbps up, Result URL: {}",
                         name,
                         result.ping.latency,
                         result.download.bandwidth / 125000,
                         result.upload.bandwidth / 125000,
                         result.result.url
                     );
                     if let Err(e) = db.insert_result(&result).await {
                         error!("Failed to insert initial result for {}: {}", name, e);
                     }
                 }
                 Err(e) => {
                     error!("Failed to run initial speedtest for {}: {}", name, e);
                 }
             }
        }
    });

    // Run HTTP server until shutdown signal
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
            info!("Shutting down");
        })
        .await?;

    Ok(())
}
