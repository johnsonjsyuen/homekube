use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
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
