import { stat } from "fs/promises";
import { Context, log } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import type { TaskInput, TaskResult } from "./types.js";
import { publishResult as natsPublish } from "./nats.js";

/** Flags that must never be passed via extraFlags */
const DENIED_FLAGS = ["-p", "--prompt", "--dangerously-skip-permissions", "--model", "--allowedTools", "--continue"];

/** Unique worker identifier, set at startup */
let workerId = "unknown";
export function setWorkerId(id: string) {
  workerId = id;
}

function validateExtraFlags(flags: string[]): void {
  for (const flag of flags) {
    const normalized = flag.split("=")[0];
    if (DENIED_FLAGS.includes(normalized)) {
      throw ApplicationFailure.nonRetryable(`Denied flag in extraFlags: ${flag}`);
    }
  }
}

export async function runClaude(input: TaskInput): Promise<TaskResult> {
  const timeoutMs = (input.timeoutSeconds ?? 300) * 1000;
  const startTime = Date.now();

  log.info("Starting task", { taskId: input.taskId, workDir: input.workDir, prompt: input.prompt.slice(0, 100) });

  // Validate workDir
  try {
    const s = await stat(input.workDir);
    if (!s.isDirectory()) {
      throw ApplicationFailure.nonRetryable(`workDir is not a directory: ${input.workDir}`);
    }
  } catch (e) {
    if (e instanceof ApplicationFailure) throw e;
    throw ApplicationFailure.nonRetryable(`Cannot access workDir: ${input.workDir}`);
  }

  // Validate extraFlags
  if (input.extraFlags?.length) {
    validateExtraFlags(input.extraFlags);
  }

  // Build command
  const args = [
    "claude",
    "--dangerously-skip-permissions",
    "-p",
    input.prompt,
    "--output-format",
    "json",
    ...(input.extraFlags ?? []),
  ];

  log.info("Spawning claude process", { taskId: input.taskId, cwd: input.workDir });

  const proc = Bun.spawn(args, {
    cwd: input.workDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Heartbeat loop
  const heartbeatInterval = setInterval(() => {
    Context.current().heartbeat(`Running for ${Math.round((Date.now() - startTime) / 1000)}s`);
  }, 10_000);

  // Watch for cancellation from Temporal
  const cancelPromise: Promise<"cancelled"> = Context.current().cancelled.catch(
    () => "cancelled" as const,
  );

  // Timeout timer
  let timeoutTimer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<"timed_out">((resolve) => {
    timeoutTimer = setTimeout(() => resolve("timed_out"), timeoutMs);
  });

  // Process completion
  const processPromise = (async () => {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  })();

  try {
    const race = await Promise.race([
      processPromise.then((r) => ({ type: "done" as const, ...r })),
      cancelPromise.then((t) => ({ type: t })),
      timeoutPromise.then((t) => ({ type: t })),
    ]);

    if (race.type === "cancelled" || race.type === "timed_out") {
      log.warn("Task interrupted", { taskId: input.taskId, reason: race.type });
      proc.kill("SIGTERM");
      const killed = await Promise.race([
        proc.exited,
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (typeof killed !== "number") {
        proc.kill("SIGKILL");
      }
      // Wait for pipe readers to finish after kill
      await processPromise.catch(() => {});

      const msg =
        race.type === "cancelled"
          ? "Cancelled by Temporal"
          : `Timed out after ${input.timeoutSeconds ?? 300}s`;
      // Timeouts/cancellations are non-retryable
      throw ApplicationFailure.nonRetryable(msg, race.type);
    }

    // Process completed normally
    const { stdout, stderr, exitCode } = race;
    const durationMs = Date.now() - startTime;

    if (exitCode === 0) {
      const result: TaskResult = {
        taskId: input.taskId,
        workflowId: `task-${input.taskId}`,
        status: "completed" as const,
        output: stdout,
        durationMs,
        workerId,
        completedAt: new Date().toISOString(),
        metadata: input.metadata,
      };
      log.info("Task completed", { taskId: input.taskId, durationMs, outputLength: stdout.length });
      return result;
    }

    // Non-zero exit — throw so Temporal retries (up to 3x per retry policy)
    log.warn("Claude exited with error", { taskId: input.taskId, exitCode, stderr: stderr.slice(0, 500) });
    throw ApplicationFailure.create({
      message: stderr || `Claude exited with code ${exitCode}`,
      type: "ClaudeExecutionError",
      nonRetryable: false,
    });
  } finally {
    clearInterval(heartbeatInterval);
    clearTimeout(timeoutTimer!);
  }
}

export async function publishTaskResult(result: TaskResult): Promise<void> {
  log.info("Publishing result to NATS", { taskId: result.taskId, status: result.status });
  await natsPublish(result.taskId, JSON.stringify(result));
  log.info("Result published", { taskId: result.taskId });
}
