import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import type { TaskInput, TaskResult } from "./types.js";
import type { claudeTask } from "./workflows.js";

export class TaskSubmitter {
  private client: Client;
  private connection: Connection;

  private constructor(connection: Connection, client: Client) {
    this.connection = connection;
    this.client = client;
  }

  static async connect(address: string, namespace = "default"): Promise<TaskSubmitter> {
    const connection = await Connection.connect({ address });
    const client = new Client({ connection, namespace });
    return new TaskSubmitter(connection, client);
  }

  /**
   * Enqueue a task. Returns the workflow ID for tracking.
   * taskQueue = the worker role to target (e.g. "worker.windows")
   * If the same taskId was already submitted, returns the existing workflow ID.
   */
  async submit(taskQueue: string, input: TaskInput): Promise<string> {
    const workflowId = `task-${input.taskId}`;

    try {
      await this.client.workflow.start<typeof claudeTask>("claudeTask", {
        workflowId,
        taskQueue,
        args: [input],
        workflowExecutionTimeout: `${(input.timeoutSeconds ?? 300) + 60}s`,
      });
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        // Dedup: same taskId already submitted
        return workflowId;
      }
      throw err;
    }

    return workflowId;
  }

  /** Get result of a completed task. Throws if not yet complete. */
  async getResult(workflowId: string): Promise<TaskResult> {
    const handle = this.client.workflow.getHandle(workflowId);
    return await handle.result();
  }

  /** Wait for task to complete and return result. */
  async waitForResult(workflowId: string, timeoutMs?: number): Promise<TaskResult> {
    const handle = this.client.workflow.getHandle(workflowId);

    if (timeoutMs) {
      return await Promise.race([
        handle.result(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out waiting for ${workflowId}`)), timeoutMs),
        ),
      ]);
    }

    return await handle.result();
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
