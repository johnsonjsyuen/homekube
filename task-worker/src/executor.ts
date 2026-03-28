export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function run(instruction: string): Promise<ExecResult> {
  const proc = Bun.spawn(["claude", "--dangerously-skip-permissions", "-p", instruction], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
  }, TIMEOUT_MS);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    // If the process was killed by our timeout, the exit code will be non-zero
    // but we want to throw a specific error so the caller can distinguish timeouts.
    if (exitCode === null) {
      throw new Error(`Claude process timed out after ${TIMEOUT_MS / 1000}s`);
    }

    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}
