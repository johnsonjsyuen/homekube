use reqwest::blocking::Client;
use reqwest::blocking::multipart;
use scopeguard::defer;

use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

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
    let _ = Command::new("docker")
        .args(&["rm", "-f", POSTGRES_CONTAINER, APP_CONTAINER])
        .output();
    let _ = Command::new("docker")
        .args(&["network", "rm", NETWORK_NAME])
        .output();
}

#[test]
fn test_tts_integration() {
    // Initial cleanup in case of leftover state
    cleanup();

    // Register deferred cleanup which will run when this function exits (returns or panics)
    defer! {
        cleanup();
    }

    run_all_tests();
}

fn wait_for_postgres() {
    println!("Waiting for Postgres to be ready...");
    for _ in 0..30 {
        // 30 retries * 1s = 30s max wait
        let status = Command::new("docker")
            .args(&[
                "exec",
                POSTGRES_CONTAINER,
                "pg_isready",
                "-U",
                "user",
                "-d",
                "tts",
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

/// Wait for the app to be ready and return the working URL
fn wait_for_app_ready(client: &Client) -> String {
    println!("Waiting for App to be ready...");
    thread::sleep(Duration::from_secs(5));

    let use_container_ip_first = std::env::var("CI").is_ok();

    for attempt in 0..10 {
        let container_ip_url =
            get_container_ip(APP_CONTAINER).map(|ip| format!("http://{}:3000", ip));

        let urls_to_try = if use_container_ip_first {
            if let Some(ip_url) = container_ip_url {
                vec![ip_url]
            } else {
                println!("Warning: Could not get container IP, falling back to localhost");
                vec!["http://127.0.0.1:3002".to_string()]
            }
        } else {
            let localhost_url = "http://127.0.0.1:3002".to_string();
            if let Some(ip_url) = container_ip_url {
                vec![localhost_url, ip_url]
            } else {
                vec![localhost_url]
            }
        };

        for target_url in urls_to_try {
            // Try a simple request to check if app is up
            let form = multipart::Form::new()
                .file("text_file", "tests/resources/test_tts_input.txt")
                .expect("Failed to create part")
                .text("voice", "af_heart")
                .text("speed", "1.0");

            match client
                .post(format!("{}/generate", target_url))
                .multipart(form)
                .send()
            {
                Ok(resp) => {
                    if resp.status().is_success() {
                        println!("App is ready at {}", target_url);
                        return target_url;
                    }
                }
                Err(e) => {
                    println!(
                        "Attempt {}: Failed to connect to {}: {}",
                        attempt + 1,
                        target_url,
                        e
                    );
                }
            }
        }

        println!("App not ready, retrying...");
        thread::sleep(Duration::from_secs(2));
    }

    print_debug_logs();
    panic!("Failed to connect to app after 10 attempts");
}

fn print_debug_logs() {
    println!("==================== APP LOGS ====================");
    if let Ok(output) = Command::new("docker")
        .args(&["logs", APP_CONTAINER])
        .output()
    {
        println!("STDOUT:\n{}", String::from_utf8_lossy(&output.stdout));
        println!("STDERR:\n{}", String::from_utf8_lossy(&output.stderr));
    }
    println!("==================================================");

    println!("================== DB LOGS ===================");
    if let Ok(output) = Command::new("docker")
        .args(&["logs", POSTGRES_CONTAINER])
        .output()
    {
        println!("STDOUT:\n{}", String::from_utf8_lossy(&output.stdout));
        println!("STDERR:\n{}", String::from_utf8_lossy(&output.stderr));
    }
    println!("==============================================");

    println!("================== CONTAINER STATUS ===================");
    if let Ok(output) = Command::new("docker")
        .args(&["ps", "-a", "--filter", &format!("name={}", APP_CONTAINER)])
        .output()
    {
        println!("{}", String::from_utf8_lossy(&output.stdout));
    }
    println!("========================================================");
}

fn setup_docker_environment() {
    println!("Creating Docker network...");
    run_command(Command::new("docker").args(&["network", "create", NETWORK_NAME]));

    println!("Starting Postgres...");
    run_command(Command::new("docker").args(&[
        "run",
        "-d",
        "--name",
        POSTGRES_CONTAINER,
        "--network",
        NETWORK_NAME,
        "-e",
        "POSTGRES_PASSWORD=password",
        "-e",
        "POSTGRES_USER=user",
        "-e",
        "POSTGRES_DB=tts",
        "postgres:15-alpine",
    ]));

    // Wait for DB startup
    wait_for_postgres();

    println!("Building TTS Image...");
    run_command(Command::new("docker").args(&["build", "-t", IMAGE_NAME, "."]));

    println!("Starting TTS App...");
    let use_host_network = std::env::var("CI").is_ok();
    let use_test_mode = std::env::var("TTS_TEST_MODE").is_ok() || std::env::var("CI").is_ok();

    if use_host_network {
        println!("CI environment detected, using host network mode...");
        let postgres_ip =
            get_container_ip(POSTGRES_CONTAINER).expect("Failed to get postgres container IP");

        let db_url = format!("DATABASE_URL=postgres://user:password@{}/tts", postgres_ip);

        let mut args = vec![
            "run",
            "-d",
            "--name",
            APP_CONTAINER,
            "--network",
            NETWORK_NAME,
            "-e",
            &db_url,
        ];
        if use_test_mode {
            args.extend(&["-e", "TTS_TEST_MODE=1"]);
        }
        args.push(IMAGE_NAME);
        run_command(Command::new("docker").args(&args));
    } else {
        let mut args = vec![
            "run",
            "-d",
            "--name",
            APP_CONTAINER,
            "--network",
            NETWORK_NAME,
            "-p",
            "3002:3000",
            "-e",
            "DATABASE_URL=postgres://user:password@tts-postgres-test-rust/tts",
        ];
        if use_test_mode {
            args.extend(&["-e", "TTS_TEST_MODE=1"]);
        }
        args.push(IMAGE_NAME);
        run_command(Command::new("docker").args(&args));
    }

    if use_test_mode {
        println!("Test mode enabled - using dummy audio generation");
    }
}

/// Run all tests in a single Docker environment for efficiency
fn run_all_tests() {
    setup_docker_environment();

    let client = Client::new();
    let base_url = wait_for_app_ready(&client);

    println!("\n========== Running Test Suite ==========\n");

    // Test 1: Happy path - generate speech and poll until complete
    test_happy_path_generate_and_complete(&client, &base_url);

    // Test 2: Missing text file
    test_generate_missing_text_file(&client, &base_url);

    // Test 3: Invalid speed parameter
    test_generate_invalid_speed(&client, &base_url);

    // Test 4: Invalid UUID for status
    test_status_invalid_uuid(&client, &base_url);

    // Test 5: Non-existent job ID
    test_status_nonexistent_job(&client, &base_url);

    // Test 6: Empty text file
    test_generate_empty_text_file(&client, &base_url);

    // Test 7: Different voice options
    test_generate_different_voices(&client, &base_url);

    // Test 8: Speed boundary values
    test_generate_speed_boundaries(&client, &base_url);

    println!("\n========== All Tests Passed! ==========\n");
}

//=============================================================================
// TEST 1: Happy Path - Generate Speech and Poll Until Complete
//=============================================================================
fn test_happy_path_generate_and_complete(client: &Client, base_url: &str) {
    println!("\n--- Test: Happy Path Generate and Complete ---");

    let form = multipart::Form::new()
        .file("text_file", "tests/resources/test_tts_input.txt")
        .expect("Failed to create part")
        .text("voice", "af_heart")
        .text("speed", "1.0");

    let resp = client
        .post(format!("{}/generate", base_url))
        .multipart(form)
        .send()
        .expect("Failed to send request");

    assert!(
        resp.status().is_success(),
        "Generate request should succeed"
    );

    let json: serde_json::Value = resp.json().expect("Failed to parse JSON");
    let job_id = json["id"].as_str().expect("No id in response");
    println!("Job ID: {}", job_id);

    // Poll until complete
    let start_time = Instant::now();
    let mut completed = false;

    while start_time.elapsed() < Duration::from_secs(60) {
        let resp = client
            .get(format!("{}/status/{}", base_url, job_id))
            .send()
            .expect("Failed to get status");

        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        if content_type.contains("audio/mpeg") {
            println!("Job Completed! Audio is ready.");

            // Verify we got actual content
            let bytes = resp.bytes().expect("Failed to read audio bytes");
            assert!(!bytes.is_empty(), "Audio response should not be empty");

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
    println!("✓ Happy path test passed!");
}

//=============================================================================
// TEST 2: Missing Text File
//=============================================================================
fn test_generate_missing_text_file(client: &Client, base_url: &str) {
    println!("\n--- Test: Missing Text File ---");

    // Send form without text_file field
    let form = multipart::Form::new()
        .text("voice", "af_heart")
        .text("speed", "1.0");

    let resp = client
        .post(format!("{}/generate", base_url))
        .multipart(form)
        .send()
        .expect("Failed to send request");

    assert_eq!(
        resp.status().as_u16(),
        400,
        "Should return 400 Bad Request when text_file is missing"
    );

    let error_text = resp.text().unwrap_or_default();
    println!("Error response: {}", error_text);
    assert!(
        error_text.contains("Missing text_file") || error_text.contains("text_file"),
        "Error message should mention missing text_file"
    );

    println!("✓ Missing text file test passed!");
}

//=============================================================================
// TEST 3: Invalid Speed Parameter
//=============================================================================
fn test_generate_invalid_speed(client: &Client, base_url: &str) {
    println!("\n--- Test: Invalid Speed Parameter ---");

    // Test with non-numeric speed
    let form = multipart::Form::new()
        .file("text_file", "tests/resources/test_tts_input.txt")
        .expect("Failed to create part")
        .text("voice", "af_heart")
        .text("speed", "not_a_number");

    let resp = client
        .post(format!("{}/generate", base_url))
        .multipart(form)
        .send()
        .expect("Failed to send request");

    assert_eq!(
        resp.status().as_u16(),
        400,
        "Should return 400 Bad Request for non-numeric speed"
    );

    let error_text = resp.text().unwrap_or_default();
    println!("Error response: {}", error_text);
    assert!(
        error_text.contains("Invalid speed") || error_text.to_lowercase().contains("speed"),
        "Error message should mention invalid speed"
    );

    println!("✓ Invalid speed parameter test passed!");
}

//=============================================================================
// TEST 4: Invalid UUID for Status
//=============================================================================
fn test_status_invalid_uuid(client: &Client, base_url: &str) {
    println!("\n--- Test: Invalid UUID for Status ---");

    let resp = client
        .get(format!("{}/status/not-a-valid-uuid", base_url))
        .send()
        .expect("Failed to send request");

    assert_eq!(
        resp.status().as_u16(),
        400,
        "Should return 400 Bad Request for invalid UUID"
    );

    let error_text = resp.text().unwrap_or_default();
    println!("Error response: {}", error_text);
    assert!(
        error_text.contains("Invalid UUID") || error_text.to_lowercase().contains("uuid"),
        "Error message should mention invalid UUID"
    );

    println!("✓ Invalid UUID test passed!");
}

//=============================================================================
// TEST 5: Non-existent Job ID
//=============================================================================
fn test_status_nonexistent_job(client: &Client, base_url: &str) {
    println!("\n--- Test: Non-existent Job ID ---");

    // Valid UUID format but doesn't exist
    let fake_uuid = "00000000-0000-0000-0000-000000000000";

    let resp = client
        .get(format!("{}/status/{}", base_url, fake_uuid))
        .send()
        .expect("Failed to send request");

    assert_eq!(
        resp.status().as_u16(),
        404,
        "Should return 404 Not Found for non-existent job"
    );

    let error_text = resp.text().unwrap_or_default();
    println!("Error response: {}", error_text);
    assert!(
        error_text.contains("not found")
            || error_text.contains("Not Found")
            || error_text.to_lowercase().contains("job"),
        "Error message should indicate job not found"
    );

    println!("✓ Non-existent job ID test passed!");
}

//=============================================================================
// TEST 6: Empty Text File
//=============================================================================
fn test_generate_empty_text_file(client: &Client, base_url: &str) {
    println!("\n--- Test: Empty Text File ---");

    // Create an empty file bytes
    let empty_bytes: Vec<u8> = Vec::new();
    let part = multipart::Part::bytes(empty_bytes)
        .file_name("empty.txt")
        .mime_str("text/plain")
        .expect("Failed to set mime type");

    let form = multipart::Form::new()
        .part("text_file", part)
        .text("voice", "af_heart")
        .text("speed", "1.0");

    let resp = client
        .post(format!("{}/generate", base_url))
        .multipart(form)
        .send()
        .expect("Failed to send request");

    // Empty file should either:
    // 1. Return success (generates silent/minimal audio)
    // 2. Return an error (explicit rejection)
    // Both are valid behaviors - we just verify it doesn't crash

    let status = resp.status();
    println!("Status for empty file: {}", status);

    if status.is_success() {
        let json: serde_json::Value = resp.json().expect("Failed to parse JSON");
        assert!(
            json["id"].is_string(),
            "Should return job ID even for empty file"
        );
        println!("Empty file accepted - job ID: {}", json["id"]);
    } else {
        let error_text = resp.text().unwrap_or_default();
        println!("Empty file rejected with: {}", error_text);
        assert!(
            status.as_u16() == 400 || status.as_u16() == 422,
            "Should return 400 or 422 for empty file rejection"
        );
    }

    println!("✓ Empty text file test passed!");
}

//=============================================================================
// TEST 7: Different Voice Options
//=============================================================================
fn test_generate_different_voices(client: &Client, base_url: &str) {
    println!("\n--- Test: Different Voice Options ---");

    let voices = vec!["af_heart", "af_bella", "bm_daniel"];

    for voice in voices {
        println!("Testing voice: {}", voice);

        let form = multipart::Form::new()
            .file("text_file", "tests/resources/test_tts_input.txt")
            .expect("Failed to create part")
            .text("voice", voice)
            .text("speed", "1.0");

        let resp = client
            .post(format!("{}/generate", base_url))
            .multipart(form)
            .send()
            .expect("Failed to send request");

        assert!(
            resp.status().is_success(),
            "Generate request should succeed for voice: {}",
            voice
        );

        let json: serde_json::Value = resp.json().expect("Failed to parse JSON");
        assert!(
            json["id"].is_string(),
            "Should return job ID for voice: {}",
            voice
        );
        println!("  Job created for voice {}: {}", voice, json["id"]);
    }

    println!("✓ Different voices test passed!");
}

//=============================================================================
// TEST 8: Speed Boundary Values
//=============================================================================
fn test_generate_speed_boundaries(client: &Client, base_url: &str) {
    println!("\n--- Test: Speed Boundary Values ---");

    // Test valid speed values
    let valid_speeds = vec!["0.5", "1.0", "1.5", "2.0"];

    for speed in valid_speeds {
        println!("Testing speed: {}", speed);

        let form = multipart::Form::new()
            .file("text_file", "tests/resources/test_tts_input.txt")
            .expect("Failed to create part")
            .text("voice", "af_heart")
            .text("speed", speed);

        let resp = client
            .post(format!("{}/generate", base_url))
            .multipart(form)
            .send()
            .expect("Failed to send request");

        assert!(
            resp.status().is_success(),
            "Generate request should succeed for speed: {}",
            speed
        );

        let json: serde_json::Value = resp.json().expect("Failed to parse JSON");
        assert!(
            json["id"].is_string(),
            "Should return job ID for speed: {}",
            speed
        );
        println!("  Job created for speed {}: {}", speed, json["id"]);
    }

    // Test extreme speed values (these should still parse as valid floats)
    let extreme_speeds = vec!["0.1", "5.0"];
    for speed in extreme_speeds {
        println!("Testing extreme speed: {}", speed);

        let form = multipart::Form::new()
            .file("text_file", "tests/resources/test_tts_input.txt")
            .expect("Failed to create part")
            .text("voice", "af_heart")
            .text("speed", speed);

        let resp = client
            .post(format!("{}/generate", base_url))
            .multipart(form)
            .send()
            .expect("Failed to send request");

        // Extreme values should either succeed or fail gracefully
        let status = resp.status();
        println!("  Extreme speed {} returned status: {}", speed, status);
        assert!(
            status.as_u16() == 200 || status.as_u16() == 400 || status.as_u16() == 422,
            "Extreme speed should return 200, 400, or 422, got: {}",
            status
        );
    }

    println!("✓ Speed boundary values test passed!");
}

fn get_container_ip(container_name: &str) -> Option<String> {
    let output = Command::new("docker")
        .args(&[
            "inspect",
            "-f",
            "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
            container_name,
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
