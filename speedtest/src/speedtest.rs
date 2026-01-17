use serde::{Deserialize, Serialize};
use std::process::Command;
use anyhow::{Result, Context};
use log::{info, error};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpeedtestResult {
    #[serde(rename = "server")]
    pub server_info: ServerInfo,
    pub ping: PingInfo,
    pub download: BandwidthInfo,
    pub upload: BandwidthInfo,
    pub result: ResultUrl,
    // Flattened fields for DB convenience (populated manually or via custom deserializer if needed, 
    // but here we'll just map them when inserting)
    #[serde(skip)]
    pub server_id: Option<i32>,
    #[serde(skip)]
    pub server_name: Option<String>,
    #[serde(skip)]
    pub server_country: Option<String>,
    #[serde(skip)]
    pub latency_ms: Option<f32>,
    #[serde(skip)]
    pub download_bandwidth: Option<i32>,
    #[serde(skip)]
    pub upload_bandwidth: Option<i32>,
    #[serde(skip)]
    pub download_bytes: Option<i32>,
    #[serde(skip)]
    pub upload_bytes: Option<i32>,
    #[serde(skip)]
    pub result_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerInfo {
    pub id: i32,
    pub name: String,
    pub location: String,
    pub country: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PingInfo {
    pub latency: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BandwidthInfo {
    pub bandwidth: i32,
    pub bytes: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResultUrl {
    pub url: String,
}

pub fn run_speedtest(server_id: Option<i32>) -> Result<SpeedtestResult> {
    let mut cmd = Command::new("speedtest");
    cmd.arg("--accept-license").arg("--accept-gdpr").arg("-f").arg("json");

    if let Some(id) = server_id {
        cmd.arg("-s").arg(id.to_string());
    }

    info!("Running speedtest for server ID: {:?}", server_id);
    let output = cmd.output().context("Failed to execute speedtest CLI")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("Speedtest failed: {}", stderr);
        anyhow::bail!("Speedtest failed: {}", stderr);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut result: SpeedtestResult = serde_json::from_str(&stdout).context("Failed to parse speedtest JSON output")?;

    // Populate flattened fields
    result.server_id = Some(result.server_info.id);
    result.server_name = Some(result.server_info.name.clone());
    result.server_country = Some(result.server_info.country.clone());
    result.latency_ms = Some(result.ping.latency);
    result.download_bandwidth = Some(result.download.bandwidth);
    result.upload_bandwidth = Some(result.upload.bandwidth);
    result.download_bytes = Some(result.download.bytes);
    result.upload_bytes = Some(result.upload.bytes);
    result.result_url = Some(result.result.url.clone());

    Ok(result)
}
