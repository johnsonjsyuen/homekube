import type { NatsConnection, JetStreamClient } from "nats";
import { JSONCodec } from "nats";
import { run } from "./executor.js";

interface Task {
  task_id: string;
  target?: string;
  required_capabilities?: string[];
  instruction: string;
  type: string;
}

interface TaskEvent {
  worker: string;
  type: string;
  task_id: string;
  timestamp: string;
  status?: string;
  result?: string;
  error?: string;
}

const codec = JSONCodec();

function publishEvent(js: JetStreamClient, event: TaskEvent): Promise<unknown> {
  return js.publish("project1.events", codec.encode(event));
}

export async function startPoller(
  nc: NatsConnection,
  js: JetStreamClient,
  workerId: string,
  capabilities: string[],
): Promise<void> {
  const consumer = await js.consumers.get("PROJECT1", "task-workers");
  console.log(`Poller started: pulling from PROJECT1/task-workers as "${workerId}"`);

  while (true) {
    let messages;
    try {
      messages = await consumer.fetch({ max_messages: 1 });
    } catch (err) {
      // If the connection is draining/closed, exit the loop gracefully
      if (nc.isClosed() || nc.isDraining()) {
        console.log("NATS connection closing, stopping poller");
        return;
      }
      console.error("Error fetching messages:", err);
      // Brief pause before retrying to avoid tight error loops
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    for await (const msg of messages) {
      let task: Task;

      // Parse the message
      try {
        task = codec.decode(msg.data) as Task;
        if (!task.task_id || !task.instruction) {
          throw new Error("Missing required fields: task_id, instruction");
        }
      } catch (err) {
        console.error("Malformed task message, discarding:", err);
        msg.ack();
        continue;
      }

      // Target filtering: if task is addressed to a different worker, nack for redelivery
      if (task.target && task.target !== workerId) {
        console.log(`Task ${task.task_id} targeted at "${task.target}", not us. Nacking.`);
        msg.nak();
        continue;
      }

      // Capability filtering: worker must have all required capabilities
      if (task.required_capabilities?.length) {
        const missing = task.required_capabilities.filter((c) => !capabilities.includes(c));
        if (missing.length > 0) {
          console.log(`Task ${task.task_id} requires [${missing.join(", ")}] which we lack. Nacking.`);
          msg.nak();
          continue;
        }
      }

      console.log(`Processing task ${task.task_id}: "${task.instruction.slice(0, 80)}..."`);

      // Publish task_started event
      await publishEvent(js, {
        worker: workerId,
        type: "task_started",
        task_id: task.task_id,
        timestamp: new Date().toISOString(),
      });

      // Execute the task
      try {
        const result = await run(task.instruction);

        if (result.exitCode === 0) {
          msg.ack();
          await publishEvent(js, {
            worker: workerId,
            type: "task_completed",
            task_id: task.task_id,
            timestamp: new Date().toISOString(),
            status: "success",
            result: result.stdout,
          });
          console.log(`Task ${task.task_id} completed successfully`);
        } else {
          msg.nak();
          await publishEvent(js, {
            worker: workerId,
            type: "task_failed",
            task_id: task.task_id,
            timestamp: new Date().toISOString(),
            status: "error",
            error: result.stderr || `Exit code: ${result.exitCode}`,
          });
          console.warn(`Task ${task.task_id} failed with exit code ${result.exitCode}`);
        }
      } catch (err) {
        msg.nak();
        const errorMsg = err instanceof Error ? err.message : String(err);
        await publishEvent(js, {
          worker: workerId,
          type: "task_failed",
          task_id: task.task_id,
          timestamp: new Date().toISOString(),
          status: "error",
          error: errorMsg,
        });
        console.error(`Task ${task.task_id} threw an error:`, errorMsg);
      }
    }
  }
}
