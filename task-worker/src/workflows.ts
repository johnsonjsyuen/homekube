import { proxyActivities, ApplicationFailure } from "@temporalio/workflow";
import type { TaskInput, TaskResult } from "./types.js";

const claudeActivities = proxyActivities<{
  runClaude: (input: TaskInput) => Promise<TaskResult>;
}>({
  startToCloseTimeout: "35 minutes", // Upper bound; actual timeout enforced in activity
  heartbeatTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ["cancelled", "timed_out"],
  },
});

const publishActivities = proxyActivities<{
  publishTaskResult: (result: TaskResult) => Promise<void>;
}>({
  startToCloseTimeout: "10 seconds",
  retry: {
    maximumAttempts: 5,
    initialInterval: "1 second",
    backoffCoefficient: 2.0,
  },
});

/** Main workflow: run Claude Code and publish the result */
export async function claudeTask(input: TaskInput): Promise<TaskResult> {
  let result: TaskResult;

  try {
    result = await claudeActivities.runClaude(input);
  } catch (err) {
    // All retries exhausted or non-retryable — build a failed result
    // Temporal wraps errors: ActivityFailure -> ApplicationFailure (cause chain)
    let cause = err;
    while (cause && typeof cause === "object" && "cause" in cause && cause.cause) {
      cause = cause.cause;
    }
    const message = cause instanceof Error ? cause.message : String(err);
    const type = cause instanceof ApplicationFailure ? cause.type : "unknown";

    result = {
      taskId: input.taskId,
      workflowId: `task-${input.taskId}`,
      status: type === "timed_out" || type === "cancelled" ? "timed_out" : "failed",
      error: message,
      durationMs: 0,
      workerId: "unknown",
      completedAt: new Date().toISOString(),
      metadata: input.metadata,
    };
  }

  await publishActivities.publishTaskResult(result);
  return result;
}
