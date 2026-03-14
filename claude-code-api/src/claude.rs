use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum ClaudeError {
    Timeout,
    NotFound(String),
    ProcessFailed(String),
    IoError(String),
}

impl std::fmt::Display for ClaudeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeError::Timeout => write!(f, "claude timed out"),
            ClaudeError::NotFound(msg) => write!(f, "claude not found: {msg}"),
            ClaudeError::ProcessFailed(msg) => write!(f, "claude process failed: {msg}"),
            ClaudeError::IoError(msg) => write!(f, "io error: {msg}"),
        }
    }
}

impl std::error::Error for ClaudeError {}

// ---------------------------------------------------------------------------
// Streaming result
// ---------------------------------------------------------------------------

pub struct StreamResult {
    pub session_id: Option<String>,
    pub full_text: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Invoke the Claude Code CLI with the given prompt.
///
/// Pipes the prompt via stdin to avoid ARG_MAX limits on large prompts.
/// Returns the raw stdout output on success.
pub async fn invoke_claude(
    prompt: &str,
    output_format: &str,
    timeout: Duration,
) -> Result<String, ClaudeError> {
    let mut child = Command::new("claude")
        .args(["--output-format", output_format, "-p", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ClaudeError::NotFound(e.to_string())
            } else {
                ClaudeError::IoError(format!("failed to spawn claude process: {e}"))
            }
        })?;

    // Write the prompt to stdin, then close it so claude reads EOF.
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ClaudeError::IoError("failed to open stdin".into()))?;
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| ClaudeError::IoError(format!("failed to write prompt to stdin: {e}")))?;
    drop(stdin);

    // Wait for the process with a timeout.
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| ClaudeError::Timeout)?
        .map_err(|e| ClaudeError::IoError(format!("failed to wait for claude process: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ClaudeError::ProcessFailed(stderr.into_owned()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Invoke Claude CLI in streaming mode, calling `line_callback` for each
/// stdout line as it arrives.
///
/// The process uses `--output-format stream-json` and
/// `--dangerously-skip-permissions`. If a `session_id` is provided the
/// `--resume` flag is added for conversation continuity.
///
/// No timeout is applied (conversations can be long). The child process is
/// killed on drop for cleanup.
pub async fn invoke_claude_streaming(
    prompt: &str,
    session_id: Option<&str>,
    mut line_callback: impl FnMut(String) + Send,
) -> Result<StreamResult, ClaudeError> {
    let mut args = vec![
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--dangerously-skip-permissions",
        "-p",
        "-",
    ];
    // Owned string to extend lifetime past args borrow.
    let session_id_owned = session_id.map(String::from);
    if let Some(ref sid) = session_id_owned {
        args.push("--resume");
        args.push(sid.as_str());
    }

    let mut child = Command::new("claude")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ClaudeError::NotFound(e.to_string())
            } else {
                ClaudeError::IoError(format!("failed to spawn claude process: {e}"))
            }
        })?;

    // Write prompt to stdin and close.
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ClaudeError::IoError("failed to open stdin".into()))?;
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| ClaudeError::IoError(format!("failed to write prompt to stdin: {e}")))?;
    drop(stdin);

    // Read stdout line by line.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ClaudeError::IoError("failed to open stdout".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut result = StreamResult {
        session_id: None,
        full_text: String::new(),
    };

    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|e| ClaudeError::IoError(format!("failed to read stdout line: {e}")))?
    {
        // Invoke callback with the raw line.
        line_callback(line.clone());

        // Parse JSON to extract text content and session_id.
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            // Capture session_id from init or result messages.
            if let Some(sid) = val.get("session_id").and_then(|v| v.as_str()) {
                result.session_id = Some(sid.to_string());
            }

            // Accumulate text from streaming deltas (stream_event wrapping content_block_delta).
            // These arrive incrementally during streaming and contain the actual text chunks.
            let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if msg_type == "stream_event" {
                if let Some(text) = val.pointer("/event/delta/text").and_then(|v| v.as_str()) {
                    result.full_text.push_str(text);
                }
            }

            // Fallback: use the assistant message text only if no deltas were received.
            // The assistant message contains the full text at the end, so using both
            // would double-count.
            if msg_type == "assistant" && result.full_text.is_empty() {
                if let Some(content) = val.pointer("/message/content").and_then(|v| v.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                result.full_text.push_str(text);
                            }
                        }
                    }
                }
            }

            // Final fallback: use result text if nothing else was captured.
            if msg_type == "result" {
                if let Some(text) = val.get("result").and_then(|v| v.as_str()) {
                    if result.full_text.is_empty() {
                        result.full_text = text.to_string();
                    }
                }
            }
        }
    }

    // Wait for the process to finish and capture stderr.
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ClaudeError::IoError("failed to open stderr".into()))?;
    let mut stderr_reader = BufReader::new(stderr);
    let mut stderr_output = String::new();
    let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut stderr_output).await;

    let status = child
        .wait()
        .await
        .map_err(|e| ClaudeError::IoError(format!("failed to wait for claude process: {e}")))?;

    if !status.success() {
        tracing::warn!(code = ?status.code(), stderr = %stderr_output, "claude process exited with non-zero status");
        // Don't fail if we already got content — the CLI sometimes exits non-zero
        // after streaming completes.
        if result.full_text.is_empty() {
            return Err(ClaudeError::ProcessFailed(format!(
                "exit code: {:?}, stderr: {}",
                status.code(),
                stderr_output.chars().take(500).collect::<String>()
            )));
        }
    }

    Ok(result)
}

/// Check whether the `claude` CLI is available by running `claude --version`.
pub async fn check_available() -> bool {
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        Command::new("claude")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
    })
    .await;

    matches!(result, Ok(Ok(status)) if status.success())
}
