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
    run_command(Command::new("docker").args(&[
        "run", "-d",
        "--name", APP_CONTAINER,
        "--network", NETWORK_NAME,
        "-p", "3002:3000",
        "-e", "DATABASE_URL=postgres://user:password@tts-postgres-test-rust/tts",
        IMAGE_NAME
    ]));

    println!("Waiting for App to be ready...");
    thread::sleep(Duration::from_secs(5));

    println!("Creating test file...");
    let mut file = File::create("test_tts_input.txt").expect("Failed to create test file");
    writeln!(file, "Hello from Rust integration test.").expect("Failed to write to file");

    let client = Client::new();
    let url = "http://127.0.0.1:3002";

    // Retry logic for initial connection
    let mut response_text = String::new();
    let mut success = false;

    for _ in 0..10 {
        let form = multipart::Form::new()
            .file("text_file", "test_tts_input.txt").expect("Failed to create part")
            .text("voice", "af_heart")
            .text("speed", "1.0");

        match client.post(format!("{}/generate", url)).multipart(form).send() {
            Ok(resp) => {
                if resp.status().is_success() {
                    response_text = resp.text().expect("Failed to read text");
                    success = true;
                    break;
                }
            }
            Err(e) => {
                println!("App not ready, retrying... Error: {}", e);
                thread::sleep(Duration::from_secs(2));
            }
        }
    }

    if !success {
        println!("==================== APP LOGS ====================");
        let _ = Command::new("docker").args(&["logs", APP_CONTAINER]).status();
        println!("==================================================");

        println!("================== DB LOGS ===================");
        let _ = Command::new("docker").args(&["logs", POSTGRES_CONTAINER]).status();
        println!("==============================================");
    }

    assert!(success, "Failed to connect to app or get successful response");

    let json: serde_json::Value = serde_json::from_str(&response_text).expect("Failed to parse JSON");
    let job_id = json["id"].as_str().expect("No id in response");
    println!("Job ID: {}", job_id);

    println!("Polling Status...");
    let start_time = Instant::now();
    let mut completed = false;

    while start_time.elapsed() < Duration::from_secs(60) {
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
