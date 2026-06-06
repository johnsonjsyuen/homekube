use anyhow::{Context, Result};
use redis::aio::MultiplexedConnection;
use redis::streams::StreamReadReply;
use redis::{RedisError, RedisResult, Value, cmd};
use std::env;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::time::{Duration, sleep};
use tracing::{info, warn};

#[derive(Clone, Debug)]
struct Config {
    redis_url: String,
    stream: String,
    group: String,
    message_count: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kvrocks_stream_demo=info,info".into()),
        )
        .init();

    let config = Config {
        redis_url: env::var("KVROCKS_URL").unwrap_or_else(|_| "redis://kvrocks:6666".to_string()),
        stream: env::var("STREAM_NAME").unwrap_or_else(|_| "demo:stream".to_string()),
        group: env::var("GROUP_NAME").unwrap_or_else(|_| "demo-group".to_string()),
        message_count: env::var("MESSAGE_COUNT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(12),
    };

    let client = redis::Client::open(config.redis_url.as_str())
        .with_context(|| format!("invalid KVROCKS_URL: {}", config.redis_url))?;

    let mut setup_conn = client
        .get_multiplexed_tokio_connection()
        .await
        .context("connect to Kvrocks")?;

    create_consumer_group(&mut setup_conn, &config.stream, &config.group).await?;

    let processed_total = Arc::new(AtomicUsize::new(0));

    let producer_client = client.clone();
    let producer_config = config.clone();
    let producer = tokio::spawn(async move { produce(producer_client, producer_config).await });

    let consumer_a = tokio::spawn(consume(
        client.clone(),
        config.clone(),
        "consumer-a".to_string(),
        processed_total.clone(),
    ));
    let consumer_b = tokio::spawn(consume(
        client.clone(),
        config.clone(),
        "consumer-b".to_string(),
        processed_total,
    ));

    producer.await.context("producer task panicked")??;
    consumer_a.await.context("consumer-a task panicked")??;
    consumer_b.await.context("consumer-b task panicked")??;

    print_pending_summary(&mut setup_conn, &config.stream, &config.group).await?;
    info!("demo complete");

    Ok(())
}

async fn create_consumer_group(
    conn: &mut MultiplexedConnection,
    stream: &str,
    group: &str,
) -> Result<()> {
    let result: RedisResult<String> = cmd("XGROUP")
        .arg("CREATE")
        .arg(stream)
        .arg(group)
        .arg("0")
        .arg("MKSTREAM")
        .query_async(conn)
        .await;

    match result {
        Ok(_) => info!(stream, group, "created consumer group"),
        Err(error) if is_busy_group(&error) => {
            info!(stream, group, "consumer group already exists")
        }
        Err(error) => return Err(error).context("create consumer group"),
    }

    Ok(())
}

async fn produce(client: redis::Client, config: Config) -> Result<()> {
    let mut conn = client
        .get_multiplexed_tokio_connection()
        .await
        .context("producer connect to Kvrocks")?;

    for seq in 1..=config.message_count {
        let id: String = cmd("XADD")
            .arg(&config.stream)
            .arg("*")
            .arg("kind")
            .arg("demo")
            .arg("seq")
            .arg(seq)
            .arg("payload")
            .arg(format!("message-{seq}"))
            .query_async(&mut conn)
            .await
            .context("xadd message")?;

        info!(stream = %config.stream, id, seq, "produced message");
        sleep(Duration::from_millis(150)).await;
    }

    Ok(())
}

async fn consume(
    client: redis::Client,
    config: Config,
    consumer: String,
    processed_total: Arc<AtomicUsize>,
) -> Result<()> {
    let mut conn = client
        .get_multiplexed_tokio_connection()
        .await
        .with_context(|| format!("{consumer} connect to Kvrocks"))?;

    let mut processed = 0usize;
    let mut idle_reads = 0usize;

    while processed_total.load(Ordering::Relaxed) < config.message_count && idle_reads < 10 {
        let reply: StreamReadReply = cmd("XREADGROUP")
            .arg("GROUP")
            .arg(&config.group)
            .arg(&consumer)
            .arg("COUNT")
            .arg(1)
            .arg("BLOCK")
            .arg(1_000)
            .arg("STREAMS")
            .arg(&config.stream)
            .arg(">")
            .query_async(&mut conn)
            .await
            .with_context(|| format!("{consumer} xreadgroup"))?;

        let Some(message) = reply.keys.first().and_then(|stream| stream.ids.first()) else {
            idle_reads += 1;
            continue;
        };

        idle_reads = 0;
        processed += 1;
        info!(
            consumer,
            id = %message.id,
            fields = ?message.map,
            "consumed message"
        );

        let acked: i64 = cmd("XACK")
            .arg(&config.stream)
            .arg(&config.group)
            .arg(&message.id)
            .query_async(&mut conn)
            .await
            .with_context(|| format!("{consumer} xack {}", message.id))?;

        info!(consumer, id = %message.id, acked, "acked message");
        processed_total.fetch_add(1, Ordering::Relaxed);
    }

    if processed_total.load(Ordering::Relaxed) < config.message_count {
        warn!(
            consumer,
            processed,
            total_processed = processed_total.load(Ordering::Relaxed),
            target = config.message_count,
            "consumer stopped after idle reads before all messages were processed"
        );
    }

    Ok(())
}

async fn print_pending_summary(
    conn: &mut MultiplexedConnection,
    stream: &str,
    group: &str,
) -> Result<()> {
    let pending: Value = cmd("XPENDING")
        .arg(stream)
        .arg(group)
        .query_async(conn)
        .await
        .context("xpending summary")?;

    info!(stream, group, pending = ?pending, "pending summary");
    Ok(())
}

fn is_busy_group(error: &RedisError) -> bool {
    error.to_string().contains("BUSYGROUP")
}
