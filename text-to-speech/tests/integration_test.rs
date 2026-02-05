use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};
use std::fs::File;
use std::io::Write;
use reqwest::blocking::Client;
use reqwest::blocking::multipart;
use scopeguard::defer;

const NETWORK_NAME: &str = "tts-integration-net-rust";
const POSTGRES_CONTAINER: &str = "tts-postgres-test-rust";
const APP_CONTAINER: &str = "tts-app-test-rust";
const IMAGE_NAME: &str = "tts-app-test-image-rust";

fn run_command(cmd: &mut Command) {
    let output = cmd.output().expect("Failed to execute command");
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("Command failed: {}", stderr);
        panic!("Command failed");
    }
}

fn cleanup() {
    println!("Cleaning up...");
    let _ = Command::new("docker").args(&["rm", "-f", POSTGRES_CONTAINER, APP_CONTAINER]).output();
    let _ = Command::new("docker").args(&["network", "rm", NETWORK_NAME]).output();
    let _ = std::fs::remove_file("test_tts_input.txt");
}

#[test]
fn test_tts_integration() {
    // Initial cleanup in case of leftover state
    cleanup();

    // Register deferred cleanup which will run when this function exits (returns or panics)
    defer! {
        cleanup();
    }

    run_test_logic();
}

fn wait_for_postgres() {
    println!("Waiting for Postgres to be ready...");
    for _ in 0..30 { // 30 retries * 1s = 30s max wait
        let status = Command::new("docker")
            .args(&[
                "exec",
                POSTGRES_CONTAINER,
                "pg_isready",
                "-U", "user",
                "-d", "tts"
            ])
            .status();

        if let Ok(s) = status {
            if s.success() {
                println!("Postgres is ready!");
                return;
            }
        }
        thread::sleep(Duration::from_secs(1));
    }
    panic!("Postgres failed to start within 30 seconds");
}

fn run_test_logic() {
    println!("Creating Docker network...");
    run_command(Command::new("docker").args(&["network", "create", NETWORK_NAME]));

    println!("Starting Postgres...");
    run_command(Command::new("docker").args(&[
        "run", "-d",
        "--name", POSTGRES_CONTAINER,
        "--network", NETWORK_NAME,
        "-e", "POSTGRES_PASSWORD=password",
        "-e", "POSTGRES_USER=user",
        "-e", "POSTGRES_DB=tts",
        "postgres:15-alpine"
    ]));

    // Wait for DB startup
    wait_for_postgres();


    println!("Building TTS Image...");
    run_command(Command::new("docker").args(&["build", "-t", IMAGE_NAME, "."]));

    println!("Starting TTS App...");
    // Use --network host to avoid Docker-in-Docker networking issues in CI
    // When running in CI (DinD), port mappings don't work as expected
    let use_host_network = std::env::var("CI").is_ok();

    if use_host_network {
        println!("CI environment detected, using host network mode...");
        // In host network mode, we need postgres to also be accessible
        // Get postgres container IP for the app to connect to
        let postgres_ip = get_container_ip(POSTGRES_CONTAINER)
            .expect("Failed to get postgres container IP");

        run_command(Command::new("docker").args(&[
            "run", "-d",
            "--name", APP_CONTAINER,
            "--network", NETWORK_NAME,
            "-e", &format!("DATABASE_URL=postgres://user:password@{}/tts", postgres_ip),
            IMAGE_NAME
        ]));
    } else {
        run_command(Command::new("docker").args(&[
            "run", "-d",
            "--name", APP_CONTAINER,
            "--network", NETWORK_NAME,
            "-p", "3002:3000",
            "-e", "DATABASE_URL=postgres://user:password@tts-postgres-test-rust/tts",
            IMAGE_NAME
        ]));
    }

    println!("Waiting for App to be ready...");
    thread::sleep(Duration::from_secs(5));

    println!("Creating test file...");
    let mut file = File::create("test_tts_input.txt").expect("Failed to create test file");
    writeln!(file, "Hello from Rust integration test.").expect("Failed to write to file");

    let client = Client::new();
    let mut url = String::new();
    let mut success = false;

    // Retry logic for initial connection
    let mut response_text = String::new();

    // In CI, port mappings don't work due to Docker-in-Docker, so use container IP directly
    let use_container_ip_first = std::env::var("CI").is_ok();

    for i in 0..10 {
        // Get container IP
        let container_ip_url = get_container_ip(APP_CONTAINER)
            .map(|ip| format!("http://{}:3000", ip));

        // Build list of URLs to try
        let urls_to_try = if use_container_ip_first {
            // In CI, try container IP first (or only)
            if let Some(ip_url) = container_ip_url {
                vec![ip_url]
            } else {
                println!("Warning: Could not get container IP, falling back to localhost");
                vec!["http://127.0.0.1:3002".to_string()]
            }
        } else {
            // Locally, try localhost first, then container IP as fallback
            let localhost_url = "http://127.0.0.1:3002".to_string();
            if let Some(ip_url) = container_ip_url {
                vec![localhost_url, ip_url]
            } else {
                vec![localhost_url]
            }
        };

        for target_url in urls_to_try {
            let form = multipart::Form::new()
                .file("text_file", "test_tts_input.txt").expect("Failed to create part")
                .text("voice", "af_heart")
                .text("speed", "1.0");

            match client.post(format!("{}/generate", target_url)).multipart(form).send() {
                Ok(resp) => {
                    if resp.status().is_success() {
                        response_text = resp.text().expect("Failed to read text");
                        success = true;
                        url = target_url; // Found working URL
                        break;
                    }
                }
                Err(e) => {
                    println!("Failed to connect to {}: {}", target_url, e);
                }
            }
        }
        
        if success {
            break;
        }

        println!("App not ready, retrying...");
        thread::sleep(Duration::from_secs(2));
    }

    if !success {
        println!("==================== APP LOGS ====================");
        if let Ok(output) = Command::new("docker").args(&["logs", APP_CONTAINER]).output() {
            println!("STDOUT:\n{}", String::from_utf8_lossy(&output.stdout));
            println!("STDERR:\n{}", String::from_utf8_lossy(&output.stderr));
        }
        println!("==================================================");

        println!("================== DB LOGS ===================");
        if let Ok(output) = Command::new("docker").args(&["logs", POSTGRES_CONTAINER]).output() {
            println!("STDOUT:\n{}", String::from_utf8_lossy(&output.stdout));
            println!("STDERR:\n{}", String::from_utf8_lossy(&output.stderr));
        }
        println!("==============================================");

        // Also print container status for debugging
        println!("================== CONTAINER STATUS ===================");
        if let Ok(output) = Command::new("docker").args(&["ps", "-a", "--filter", &format!("name={}", APP_CONTAINER)]).output() {
            println!("{}", String::from_utf8_lossy(&output.stdout));
        }
        println!("========================================================");
    }

    assert!(success, "Failed to connect to app or get successful response");

    println!("Connected successfully to {}", url);

    let json: serde_json::Value = serde_json::from_str(&response_text).expect("Failed to parse JSON");
    let job_id = json["id"].as_str().expect("No id in response");
    println!("Job ID: {}", job_id);

    println!("Polling Status...");
    let start_time = Instant::now();
    let mut completed = false;

    while start_time.elapsed() < Duration::from_secs(60) {
        // Use the confirmed working URL
        let resp = client.get(format!("{}/status/{}", url, job_id)).send().expect("Failed to get status");

        let content_type = resp.headers().get("content-type").and_then(|h| h.to_str().ok()).unwrap_or("");

        if content_type.contains("audio/mpeg") {
            println!("Job Completed! Audio is ready.");
            completed = true;
            break;
        }

        let body: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
        if body["status"] == "error" {
            panic!("Job failed with error: {}", body["message"]);
        }

        println!("Status: Processing...");
        thread::sleep(Duration::from_secs(2));
    }

    assert!(completed, "Timed out waiting for TTS completion");
    println!("Integration Test Passed!");
}

fn get_container_ip(container_name: &str) -> Option<String> {
    let output = Command::new("docker")
        .args(&[
            "inspect",
            "-f",
            "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
            container_name
        ])
        .output()
        .ok()?;
    
    if output.status.success() {
        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ip.is_empty() {
            return Some(ip);
        }
    }
    None
}
